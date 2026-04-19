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
import { useParams } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { GitBranch, RefreshCw } from 'lucide-react';
import { activeWorkspaceAtom, workspacesAtom } from '../../atoms/workspaces';
import { focusModeAtom, leftPanelWidthAtom, bottomPanelHeightAtom, activeWorkspaceIdAtom } from '../../atoms/ui';
import { gitStateAtomFamily } from '../../atoms/git';
import { useTranslation } from '../../lib/i18n';
import { TopBar } from '../topbar';
import { AgentPanes } from '../agent-panes';
import { TerminalPanel } from '../terminal-panel';
import { FileTreePanel } from './components/file-tree';
import { GitPanel } from './components/git-panel';
import { GitDiffViewer } from './components/git-diff-viewer';
import { dispatchCommandAtom } from '../../atoms/connection';
import type { GitStatus, Workspace } from '@coder-studio/core';

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
  const { id: urlWorkspaceId } = useParams<{ id: string }>();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspace?.id ?? '__workspace_placeholder__'));
  const focusMode = useAtomValue(focusModeAtom);
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const store = useStore();
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const [resolvingWorkspaceId, setResolvingWorkspaceId] = useState<string | null>(() =>
    urlWorkspaceId && !workspaces[urlWorkspaceId] ? urlWorkspaceId : null
  );
  const lastWorkspaceFetchRef = useRef<string | null>(null);

  // Sync URL workspace ID to state
  useEffect(() => {
    if (urlWorkspaceId) {
      setActiveWorkspaceId(urlWorkspaceId);
    }
  }, [urlWorkspaceId, setActiveWorkspaceId]);

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

  // Fetch workspace list if current workspace not in state
  useEffect(() => {
    if (!urlWorkspaceId) {
      setResolvingWorkspaceId(null);
      lastWorkspaceFetchRef.current = null;
      return;
    }

    if (workspaces[urlWorkspaceId]) {
      setResolvingWorkspaceId(null);
      lastWorkspaceFetchRef.current = null;
      return;
    }

    if (lastWorkspaceFetchRef.current === urlWorkspaceId) {
      return;
    }

    lastWorkspaceFetchRef.current = urlWorkspaceId;
    setResolvingWorkspaceId(urlWorkspaceId);

    let cancelled = false;

    dispatch<Workspace[]>('workspace.list', {})
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.ok && result.data) {
          const wsMap: Record<string, Workspace> = {};
          for (const ws of result.data) {
            wsMap[ws.id] = ws;
          }

          setWorkspaces((current) => ({
            ...current,
            ...wsMap,
          }));

          if (wsMap[urlWorkspaceId]) {
            return;
          }
        }

        setResolvingWorkspaceId((current) => (current === urlWorkspaceId ? null : current));
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to fetch workspace list:', err);
          setResolvingWorkspaceId((current) => (current === urlWorkspaceId ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [urlWorkspaceId, workspaces, dispatch, setWorkspaces]);

  // Sidebar tab state
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);

  // Resizer drag state
  const isDraggingLeft = useRef(false);
  const isDraggingBottom = useRef(false);

  // Left panel resize handlers
  const handleLeftMouseDown = useCallback(() => {
    isDraggingLeft.current = true;
    document.body.classList.add('is-resizing-panels');
  }, []);

  const handleLeftMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft.current) return;
    const newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, e.clientX));
    setLeftPanelWidth(newWidth);
  }, [setLeftPanelWidth]);

  const handleLeftMouseUp = useCallback(() => {
    isDraggingLeft.current = false;
    document.body.classList.remove('is-resizing-panels');
  }, []);

  // Bottom panel resize handlers
  const handleBottomMouseDown = useCallback(() => {
    isDraggingBottom.current = true;
    document.body.classList.add('is-resizing-panels');
  }, []);

  const handleBottomMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingBottom.current) return;
    const newHeight = Math.max(
      MIN_BOTTOM_HEIGHT,
      Math.min(MAX_BOTTOM_HEIGHT, window.innerHeight - TOPBAR_HEIGHT - e.clientY)
    );
    setBottomPanelHeight(newHeight);
  }, [setBottomPanelHeight]);

  const handleBottomMouseUp = useCallback(() => {
    isDraggingBottom.current = false;
    document.body.classList.remove('is-resizing-panels');
  }, []);

  // Setup event listeners for resize
  useEffect(() => {
    document.addEventListener('mousemove', handleLeftMouseMove);
    document.addEventListener('mousemove', handleBottomMouseMove);
    document.addEventListener('mouseup', handleLeftMouseUp);
    document.addEventListener('mouseup', handleBottomMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleLeftMouseMove);
      document.removeEventListener('mousemove', handleBottomMouseMove);
      document.removeEventListener('mouseup', handleLeftMouseUp);
      document.removeEventListener('mouseup', handleBottomMouseUp);
    };
  }, [handleLeftMouseMove, handleLeftMouseUp, handleBottomMouseMove, handleBottomMouseUp]);

  const isResolvingWorkspace = Boolean(
    urlWorkspaceId && !workspace && resolvingWorkspaceId === urlWorkspaceId
  );

  if (!workspace) {
    return (
      <div className="workspace-page">
        <TopBar />
        {isResolvingWorkspace ? (
          <div className="workspace-resolving-shell" data-testid="workspace-resolving-shell">
            <div className="workspace-resolving-card">
              <div className="workspace-resolving-kicker">WORKSPACE INITIALIZING</div>
              <h1 className="workspace-resolving-title">正在进入工作区...</h1>
              <p className="workspace-resolving-desc">
                正在同步 workspace 元数据、会话和文件树，界面准备完成后会自动展开。
              </p>

              <div className="workspace-resolving-preview" aria-hidden="true">
                <div className="workspace-resolving-preview-topbar">
                  <span className="workspace-resolving-pill workspace-resolving-pill-active" />
                  <span className="workspace-resolving-pill" />
                  <span className="workspace-resolving-pill workspace-resolving-pill-short" />
                </div>

                <div className="workspace-resolving-preview-body">
                  <div className="workspace-resolving-preview-sidebar">
                    <span className="workspace-resolving-line workspace-resolving-line-label" />
                    <span className="workspace-resolving-line workspace-resolving-line-strong" />
                    <span className="workspace-resolving-line" />
                    <span className="workspace-resolving-line workspace-resolving-line-wide" />
                    <span className="workspace-resolving-line" />
                  </div>

                  <div className="workspace-resolving-preview-main">
                    <div className="workspace-resolving-console">
                      <span className="workspace-resolving-console-status" />
                      <span className="workspace-resolving-console-line workspace-resolving-console-line-title" />
                      <span className="workspace-resolving-console-line" />
                      <span className="workspace-resolving-console-line workspace-resolving-console-line-wide" />
                      <span className="workspace-resolving-console-line workspace-resolving-console-line-short" />
                    </div>

                    <div className="workspace-resolving-terminal">
                      <span className="workspace-resolving-line workspace-resolving-line-label" />
                      <span className="workspace-resolving-console-line workspace-resolving-console-line-wide" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace-empty-content">
            <div className="workspace-empty-inner">
              <p>{t('workspace.no_workspace') || 'No workspace loaded'}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  const activeTabLabel = activeTab === 'files' ? 'Files' : 'Git Diff';
  const panelKicker = activeTab === 'git' ? 'SOURCE CONTROL' : 'REPOSITORY NAVIGATOR';
  const panelBranch = gitState?.branch ?? 'main';

  return (
    <div className={`workspace-page ${focusMode ? 'workspace-page-focus' : ''}`}>
      {/* TopBar - always visible, full width */}
      <TopBar />

      {/* Workspace body: flex row containing left panel + main area */}
      <div className={`workspace-body ${focusMode ? 'workspace-body-focus' : ''}`}>
        {/* Left panel - hidden in focus mode */}
        {!focusMode && (
          <>
            <aside
              className="left-panel"
              style={{ width: `${leftPanelWidth}px` }}
            >
              <div className="nav-panel">
                <div className="panel-header">
                  <div className="panel-kicker">{panelKicker}</div>
                  <div className="panel-branch">
                    <GitBranch size={12} />
                    <span>{panelBranch}</span>
                  </div>
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
                      title={`Refresh ${activeTabLabel}`}
                      onClick={() => setPanelRefreshToken((prev) => prev + 1)}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : null}

                <div className="panel-body">
                  {activeTab === 'files' ? (
                    <FileTreePanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
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
          {/* Agent Panes - takes remaining space */}
          {activeTab === 'git' ? (
            <GitDiffViewer workspaceId={workspace.id} />
          ) : (
            <div className="agent-panes">
              <AgentPanes />
            </div>
          )}

          {/* Bottom panel resizer - hidden in focus mode */}
          {!focusMode && (
            <div
              className="split-divider-h"
              onMouseDown={handleBottomMouseDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom panel"
            />
          )}

          {/* Terminal Panel - hidden in focus mode */}
          {!focusMode && (
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
