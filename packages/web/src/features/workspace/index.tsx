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
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';
import { focusModeAtom, leftPanelWidthAtom, bottomPanelHeightAtom } from '../../atoms/ui';
import { gitStateAtomFamily } from '../../atoms/git';
import { activeFilePathAtomFamily } from '../../atoms/fs';
import { useTranslation } from '../../lib/i18n';
import { TopBar } from '../topbar';
import { AgentPanes } from '../agent-panes';
import { TerminalPanel } from '../terminal-panel';
import { FileTreePanel } from './components/file-tree';
import { GitPanel } from './components/git-panel';
import { GitDiffViewer } from './components/git-diff-viewer';
import { CodeEditorHost } from '../code-editor';
import { dispatchCommandAtom, connectionStatusAtom } from '../../atoms/connection';
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
  const workspace = useAtomValue(activeWorkspaceAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspace?.id ?? '__workspace_placeholder__'));
  const focusMode = useAtomValue(focusModeAtom);
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const store = useStore();
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const workspacesLoadError = useAtomValue(workspacesLoadErrorAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

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

  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoadState('loading');
    setWorkspacesLoadError(null);

    const result = await dispatch<Workspace[]>('workspace.list', {});

    if (!result.ok) {
      const message = result.error?.message ?? 'Failed to fetch workspace list';
      console.error('Failed to fetch workspace list:', message);
      setWorkspacesLoadState('error');
      setWorkspacesLoadError(message);
      return;
    }

    const nextWorkspaces = Array.isArray(result.data) ? result.data : [];
    const wsMap: Record<string, Workspace> = {};

    for (const nextWorkspace of nextWorkspaces) {
      wsMap[nextWorkspace.id] = nextWorkspace;
    }

    setWorkspaces(wsMap);
    setWorkspaceOrder(nextWorkspaces.map((nextWorkspace) => nextWorkspace.id));
    setWorkspacesLoadState('ready');
    setWorkspacesLoadError(null);
  }, [
    dispatch,
    setWorkspaceOrder,
    setWorkspaces,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
  ]);

  useEffect(() => {
    if (connectionStatus !== 'connected' || workspacesLoadState !== 'idle') {
      return;
    }

    void loadWorkspaces();
  }, [connectionStatus, loadWorkspaces, workspacesLoadState]);

  // Sidebar tab state
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);
  const [createRequest, setCreateRequest] = useState<{
    id: number;
    mode: 'file' | 'folder';
    baseDir: string | null;
  } | null>(null);

  // Active file path drives the central area: when set (and the Files tab is
  // active) we swap AgentPanes out for the code editor, mirroring how Git Diff
  // swaps in its own viewer when selected.
  const activeFilePath = useAtomValue(
    activeFilePathAtomFamily(workspace?.id ?? '__workspace_placeholder__')
  );

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

  if (workspacesLoadState === 'idle' || workspacesLoadState === 'loading') {
    return (
      <div className="workspace-page">
        <TopBar />
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
      </div>
    );
  }

  if (workspacesLoadState === 'error') {
    return (
      <div className="workspace-page">
        <TopBar />
        <div className="workspace-empty-content" data-testid="workspace-error-shell">
          <div className="workspace-empty-inner">
            <p>{workspacesLoadError ?? 'Failed to fetch workspace list'}</p>
            <button type="button" onClick={() => void loadWorkspaces()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="workspace-page">
        <TopBar />
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <p>{t('workspace.no_workspace') || 'No workspace loaded'}</p>
          </div>
        </div>
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
          {/* Central area routing:
           *   - Git tab  → GitDiffViewer
           *   - Files tab + a file selected → CodeEditorHost (editable Monaco)
           *   - Files tab + no file selected → AgentPanes (default)
           * The editor replaces AgentPanes exactly the way GitDiffViewer does,
           * so behavior stays symmetrical with the existing Git workflow.
           */}
          {activeTab === 'git' ? (
            <GitDiffViewer workspaceId={workspace.id} />
          ) : activeFilePath ? (
            <CodeEditorHost />
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
