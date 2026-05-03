import type { FC } from 'react';
import { FilePlus, FolderPlus, GitBranch, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import { AgentPanes } from '../../../agent-panes';
import { CodeEditorHost } from '../../../code-editor/views/shared/code-editor-host';
import { TerminalPanel } from '../../../terminal-panel';
import { TopBar } from '../../../topbar';
import { useWorkspaceScreenModel } from '../../actions/use-workspace-screen-model';
import { FileTreePanel } from '../shared/file-tree-panel';
import { GitDiffViewer } from '../shared/git-diff-viewer';
import { GitPanel } from '../shared/git-panel';
import { GitStatusBar } from '../shared/git-status-bar';

export const WorkspaceDesktopView: FC = () => {
  const t = useTranslation();
  const {
    createRequest,
    focusMode,
    gitState,
    handleBottomMouseDown,
    handleConsumeCreateRequest,
    handleLeftMouseDown,
    handleOpenBranchSwitcher,
    handleOpenFileCreate,
    handleOpenFolderCreate,
    handleRefreshSidebarPanel,
    leftPanelWidth,
    mainAreaMode,
    panelRefreshToken,
    setSidebarTab,
    sidebarCollapsed,
    sidebarTab,
    terminalPanelVisible,
    workspace,
    bottomPanelHeight,
  } = useWorkspaceScreenModel();

  if (!workspace) {
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

  const panelKicker = sidebarTab === 'files' ? t('label.file') : t('label.git');
  const panelBranch = gitState?.branch ?? '—';
  const activeTabLabel = sidebarTab === 'files' ? 'file tree' : 'git diff';

  return (
    <div className="workspace-page">
      <TopBar />

      <div className="workspace-body">
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
                  <div className="panel-tabs-row">
                    <div className="panel-tabs">
                      <button
                        className={`panel-tab ${sidebarTab === 'files' ? 'active' : ''}`}
                        onClick={() => setSidebarTab('files')}
                      >
                        Files
                      </button>
                      <button
                        className={`panel-tab ${sidebarTab === 'git' ? 'active' : ''}`}
                        onClick={() => setSidebarTab('git')}
                      >
                        Git Diff
                      </button>
                    </div>
                    <GitStatusBar workspaceId={workspace.id} gitState={gitState} inline />
                  </div>
                </div>

                {sidebarTab === 'files' ? (
                  <div className="panel-toolbar">
                    <button
                      className="panel-toolbar-btn"
                      title={t('file.new_file')}
                      aria-label={t('file.new_file')}
                      onClick={handleOpenFileCreate}
                    >
                      <FilePlus size={14} />
                    </button>
                    <button
                      className="panel-toolbar-btn"
                      title={t('file.new_folder')}
                      aria-label={t('file.new_folder')}
                      onClick={handleOpenFolderCreate}
                    >
                      <FolderPlus size={14} />
                    </button>
                    <button
                      className="panel-toolbar-btn"
                      title={`Refresh ${activeTabLabel}`}
                      aria-label={`Refresh ${activeTabLabel}`}
                      onClick={handleRefreshSidebarPanel}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : null}

                <div className="panel-body">
                  {sidebarTab === 'files' ? (
                    <FileTreePanel
                      workspaceId={workspace.id}
                      refreshToken={panelRefreshToken}
                      createRequest={createRequest}
                      onCreateRequestConsumed={handleConsumeCreateRequest}
                    />
                  ) : (
                    <GitPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  )}
                </div>
              </div>
            </aside>

            <div
              className="split-divider-v"
              onMouseDown={handleLeftMouseDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize left panel"
            />
          </>
        )}

        <div className="workspace-main-area">
          {mainAreaMode === 'diff' ? (
            <GitDiffViewer workspaceId={workspace.id} />
          ) : mainAreaMode === 'editor' ? (
            <CodeEditorHost />
          ) : (
            <div className="agent-panes">
              <AgentPanes hydrateSessions={false} />
            </div>
          )}

          {!focusMode && terminalPanelVisible && (
            <div
              className="split-divider-h"
              onMouseDown={handleBottomMouseDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom panel"
            />
          )}

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

export { WorkspaceDesktopView as WorkspacePage };
export default WorkspaceDesktopView;
