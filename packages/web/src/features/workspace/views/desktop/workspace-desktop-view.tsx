import { useSetAtom } from "jotai";
import { ChevronsUp, FilePlus, FolderPlus } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { AgentPanes } from "../../../agent-panes";
import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
import { TerminalPanel } from "../../../terminal-panel";
import { TopBar } from "../../../topbar";
import { useGitDiffViewerActions } from "../../actions/use-git-actions";
import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
import { activeFilePathAtomFamily, sidebarCollapsedAtom } from "../../atoms";
import { FileTreePanel } from "../shared/file-tree-panel";
import { GitDiffViewer } from "../shared/git-diff-viewer";
import { GitPanel } from "../shared/git-panel";
import { WorkspaceStatusBar } from "../shared/workspace-status-bar";

export const WorkspaceDesktopView: FC = () => {
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const fullscreenController = useWorkspaceFullscreen(fullscreenRootRef);
  const [fileTreeCollapseVersion, setFileTreeCollapseVersion] = useState(0);
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
    leftPanelWidth,
    leftPanelRef,
    mainAreaMode,
    setSidebarTab,
    sidebarCollapsed,
    sidebarTab,
    terminalPanelVisible,
    workspace,
    bottomPanelHeight,
    bottomPanelRef,
    workspaceId,
  } = useWorkspaceScreenModel();
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const { closePreview } = useGitDiffViewerActions(workspaceId);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        setSidebarTab("files");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        setSidebarTab("git");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSidebarCollapsed, setSidebarTab]);

  if (!workspace) {
    return (
      <div className="workspace-page workspace-page-empty">
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <p>{t("workspace.no_workspace")}</p>
          </div>
        </div>
      </div>
    );
  }

  const handleCloseDiff = () => {
    closePreview();
    setActiveFilePath(null);
  };

  return (
    <div ref={fullscreenRootRef} className="workspace-page">
      <TopBar fullscreenController={fullscreenController} />

      <div className="workspace-body">
        {!focusMode && !sidebarCollapsed && (
          <>
            <aside
              ref={leftPanelRef}
              className="left-panel"
              style={{ width: `${leftPanelWidth}px` }}
            >
              <div className="nav-panel workspace-sidebar-panel">
                <div className="workspace-sidebar-panel__header">
                  <div
                    className="workspace-sidebar-panel__tabs"
                    role="tablist"
                    aria-label="Sidebar tabs"
                  >
                    <button
                      type="button"
                      className={`workspace-sidebar-panel__tab ${
                        sidebarTab === "files" ? "active" : ""
                      }`}
                      onClick={() => setSidebarTab("files")}
                    >
                      <span>{t("file.title")}</span>
                    </button>
                    <button
                      type="button"
                      className={`workspace-sidebar-panel__tab ${sidebarTab === "git" ? "active" : ""}`}
                      onClick={() => setSidebarTab("git")}
                    >
                      <span>{t("label.git")}</span>
                    </button>
                  </div>

                  <div className="workspace-sidebar-panel__actions">
                    {sidebarTab === "files" ? (
                      <>
                        <button
                          type="button"
                          className="panel-toolbar-btn"
                          title={t("file.new_file")}
                          aria-label={t("file.new_file")}
                          onClick={handleOpenFileCreate}
                        >
                          <FilePlus size={14} />
                        </button>
                        <button
                          type="button"
                          className="panel-toolbar-btn"
                          title={t("file.new_folder")}
                          aria-label={t("file.new_folder")}
                          onClick={handleOpenFolderCreate}
                        >
                          <FolderPlus size={14} />
                        </button>
                        <button
                          type="button"
                          className="panel-toolbar-btn"
                          title={t("file.collapse_all")}
                          aria-label={t("file.collapse_all")}
                          onClick={() => setFileTreeCollapseVersion((value) => value + 1)}
                        >
                          <ChevronsUp size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="workspace-sidebar-panel__body">
                  {sidebarTab === "files" ? (
                    <FileTreePanel
                      workspaceId={workspace.id}
                      createRequest={createRequest}
                      onCreateRequestConsumed={handleConsumeCreateRequest}
                      collapseVersion={fileTreeCollapseVersion}
                      variant="desktop"
                    />
                  ) : (
                    <GitPanel workspaceId={workspace.id} variant="desktop" />
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
          {mainAreaMode === "diff" ? (
            <GitDiffViewer workspaceId={workspace.id} onClose={handleCloseDiff} />
          ) : mainAreaMode === "editor" ? (
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
            <div
              ref={bottomPanelRef}
              className="workspace-bottom-panel"
              style={{ height: `${bottomPanelHeight}px` }}
            >
              <TerminalPanel />
            </div>
          )}
        </div>
      </div>

      <WorkspaceStatusBar
        workspaceId={workspace.id}
        gitState={gitState}
        onOpenBranchSwitcher={handleOpenBranchSwitcher}
      />
    </div>
  );
};

export { WorkspaceDesktopView as WorkspacePage };
export default WorkspaceDesktopView;
