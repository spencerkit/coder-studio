/**
 * Workspace Page Feature
 *
 * Main workspace view with left panel (file tree/git), central panel (agent panes),
 * and bottom panel (terminal). All panels are resizable.
 *
 * Layout matches the visual mockup:
 * - TopBar: full-width top bar
 * - workspace-body: flex row containing left-panel + workspace-main-area
 * - workspace-main-area: flex column containing agent-panes + bottom-terminal
 */

import type { FC } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { FilePlus, FolderPlus, GitBranch, RefreshCw } from 'lucide-react';
import {
  activeWorkspaceAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';
import { focusModeAtom, leftPanelWidthAtom, bottomPanelHeightAtom, terminalPanelVisibleAtom, sidebarCollapsedAtom } from '../../atoms/ui';
import { gitStateAtomFamily, branchQuickPickAtom } from '../../atoms/git';
import { activeFilePathAtomFamily } from '../../atoms/fs';
import { useTranslation } from '../../lib/i18n';
import { TopBar } from '../topbar';
import { AgentPanes } from '../agent-panes';
import { TerminalPanel } from '../terminal-panel';
import { FileTreePanel } from './components/file-tree';
import { GitPanel } from './components/git-panel';
import { GitDiffViewer } from './components/git-diff-viewer';
import { CodeEditorHost } from '../code-editor';
import { dispatchCommandAtom } from '../../atoms/connection';
import type { GitStatus } from '@coder-studio/core';

/** Minimum panel sizes in pixels */
const TOPBAR_HEIGHT = 36;
const DEFAULT_LEFT_WIDTH = 280;
const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_WIDTH = 480;
const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_HEIGHT = 400;

/**
 * Workspace Page
 *
 * PRD §7:
 *   - Layout: TopBar | Left panel | Central panel | Bottom panel
 *   - Left panel: File tree / Git diff switcher (resizable)
 *   - Central: Agent pane tree (multiple sessions)
 *   - Bottom: Terminal panel (resizable)
 */
export const WorkspacePage: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspace?.id ?? '__workspace_placeholder__'));
  const focusMode = useAtomValue(focusModeAtom);
  const terminalPanelVisible = useAtomValue(terminalPanelVisibleAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const store = useStore();
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const workspacesLoadError = useAtomValue(workspacesLoadErrorAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setBranchQuickPick = useSetAtom(branchQuickPickAtom);

  useEffect(() => {
    if (leftPanelWidth === 200 || leftPanelWidth === 220 || leftPanelWidth === 264) {
      setLeftPanelWidth(DEFAULT_LEFT_WIDTH);
    }
  }, [leftPanelWidth, setLeftPanelWidth]);

  useEffect(() => {
    if (!workspace || gitState) {
      return;
    }

    let cancelled = false;

    dispatch<GitStatus>('git.status', { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          return;
        }

        store.set(gitStateAtomFamily(workspace.id), result.data);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load git status:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, gitState, dispatch, store]);

  const leftMouseDown = useRef(false);
  const leftStartX = useRef(0);
  const leftStartWidth = useRef(0);

  const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
    leftMouseDown.current = true;
    leftStartX.current = e.clientX;
    leftStartWidth.current = leftPanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!leftMouseDown.current) return;
      const dx = moveEvent.clientX - leftStartX.current;
      const nextWidth = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, leftStartWidth.current + dx));
      setLeftPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      leftMouseDown.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftPanelWidth, setLeftPanelWidth]);

  const bottomMouseDown = useRef(false);
  const bottomStartY = useRef(0);
  const bottomStartHeight = useRef(0);

  const handleBottomMouseDown = useCallback((e: React.MouseEvent) => {
    bottomMouseDown.current = true;
    bottomStartY.current = e.clientY;
    bottomStartHeight.current = bottomPanelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!bottomMouseDown.current) return;
      const dy = bottomStartY.current - moveEvent.clientY;
      const nextHeight = Math.min(
        MAX_BOTTOM_HEIGHT,
        Math.max(MIN_BOTTOM_HEIGHT, bottomStartHeight.current + dy)
      );
      setBottomPanelHeight(nextHeight);
    };

    const onMouseUp = () => {
      bottomMouseDown.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [bottomPanelHeight, setBottomPanelHeight]);

  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const [createRequest, setCreateRequest] = useState<{
    id: number;
    mode: 'file' | 'folder';
    baseDir: string | null;
  } | null>(null);
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);

  const activeFilePath = useAtomValue(
    activeFilePathAtomFamily(workspace?.id ?? '__workspace_placeholder__')
  );

  const handleOpenBranchSwitcher = useCallback(() => {
    if (!workspace) {
      return;
    }

    setActiveTab('git');
    setBranchQuickPick({
      visible: true,
      workspaceId: workspace.id,
      inputValue: '',
    });
  }, [setBranchQuickPick, workspace]);

  if (!workspace) {
    if (workspacesLoadState === 'error') {
      return (
        <div className="workspace-resolving-shell">
          <div className="workspace-resolving-card">
            <div className="workspace-resolving-kicker">Workspace</div>
            <div className="workspace-resolving-title">Failed to load workspaces</div>
            <div className="workspace-resolving-desc">
              {workspacesLoadError ?? 'Failed to fetch workspace list'}
            </div>
          </div>
        </div>
      );
    }

    if (workspacesLoadState === 'idle' || workspacesLoadState === 'loading') {
      return (
        <div className="workspace-resolving-shell" data-testid="workspace-resolving-shell">
          <div className="workspace-resolving-card">
            <div className="workspace-resolving-kicker">Workspace</div>
            <div className="workspace-resolving-title">Loading workspaces</div>
            <div className="workspace-resolving-desc">
              Preparing your workspace list and restoring the last active session.
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="workspace-page workspace-page-empty">
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <p>{t('workspace.no_workspace')}</p>
          </div>
        </div>
      </div>
    );
  }

  const panelKicker = activeTab === 'files' ? t('file') : t('git');
  const panelBranch = gitState?.branch ?? '—';
  const activeTabLabel = activeTab === 'files' ? 'file tree' : 'git diff';

  return (
    <div className="workspace-page">
      <TopBar />

      <div className="workspace-body">
        {/* Left panel - hidden in focus mode or collapsed */}
        {!focusMode && !sidebarCollapsed && (
          <>
            <aside className="left-panel" style={{ width: `${leftPanelWidth}px` }}>
              <div className="nav-panel">
                <div className="panel-header">
                  <div className="panel-kicker">{panelKicker}</div>
                  <button
                    className="panel-branch panel-branch-button"
                    onClick={handleOpenBranchSwitcher}
                    aria-label={`Open branch switcher for ${panelBranch}`}
                    type="button"
                  >
                    <GitBranch size={12} />
                    <span>{panelBranch}</span>
                  </button>
                  <div className="panel-tabs">
                    <button
                      className={`panel-tab ${activeTab === 'files' ? 'active' : ''}`}
                      onClick={() => setActiveTab('files')}
                    >
                      Files
                    </button>
                    <button
                      className={`panel-tab ${activeTab === 'git' ? 'active' : ''}`}
                      onClick={() => setActiveTab('git')}
                    >
                      Git Diff
                    </button>
                  </div>
                </div>

                {activeTab === 'files' ? (
                  <div className="panel-toolbar">
                    <button
                      className="panel-toolbar-btn"
                      title={t('file.new_file')}
                      aria-label={t('file.new_file')}
                      onClick={() =>
                        setCreateRequest((prev) => ({
                          id: (prev?.id ?? 0) + 1,
                          mode: 'file',
                          baseDir: null,
                        }))
                      }
                    >
                      <FilePlus size={14} />
                    </button>
                    <button
                      className="panel-toolbar-btn"
                      title={t('file.new_folder')}
                      aria-label={t('file.new_folder')}
                      onClick={() =>
                        setCreateRequest((prev) => ({
                          id: (prev?.id ?? 0) + 1,
                          mode: 'folder',
                          baseDir: null,
                        }))
                      }
                    >
                      <FolderPlus size={14} />
                    </button>
                    <button
                      className="panel-toolbar-btn"
                      title={`Refresh ${activeTabLabel}`}
                      aria-label={`Refresh ${activeTabLabel}`}
                      onClick={() => setPanelRefreshToken((prev) => prev + 1)}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : null}

                <div className="panel-body">
                  {activeTab === 'files' ? (
                    <FileTreePanel
                      workspaceId={workspace.id}
                      refreshToken={panelRefreshToken}
                      createRequest={createRequest}
                      onCreateRequestConsumed={() => setCreateRequest(null)}
                    />
                  ) : (
                    <GitPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  )}
                </div>
              </div>
            </aside>

            {/* Left panel resizer */}
            <div
              className="split-divider-v"
              onMouseDown={handleLeftMouseDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize left panel"
            />
          </>
        )}

        {/* Central area: agent panes + terminal panel */}
        <div className="workspace-main-area">
          {activeTab === 'git' ? (
            <GitDiffViewer workspaceId={workspace.id} />
          ) : activeFilePath ? (
            <CodeEditorHost />
          ) : (
            <div className="agent-panes">
              <AgentPanes />
            </div>
          )}

          {/* Bottom panel resizer - hidden in focus mode or when terminal hidden */}
          {!focusMode && terminalPanelVisible && (
            <div
              className="split-divider-h"
              onMouseDown={handleBottomMouseDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom panel"
            />
          )}

          {/* Terminal Panel - hidden in focus mode or when toggled off */}
          {!focusMode && terminalPanelVisible && (
            <div className="workspace-bottom-panel" style={{ height: `${bottomPanelHeight}px` }}>
              <TerminalPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspacePage;
