import { useSetAtom } from "jotai";
import { ChevronsUp } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import {
  EmptyState,
  IconButton,
  Tab,
  TabList,
  Tabs,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { AgentPanes } from "../../../agent-panes";
import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
import { PanelHeader } from "../../../shared/components/panel-header";
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
            <EmptyState
              style={{ minHeight: "auto", padding: 0 }}
              title={<p>{t("workspace.no_workspace")}</p>}
            />
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
    <div ref={fullscreenRootRef} className="workspace-page workspace-page--desktop">
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
                <PanelHeader
                  title={t("workspace.title")}
                  meta={
                    <Tabs
                      aria-label="Workspace sections"
                      onValueChange={setSidebarTab}
                      value={sidebarTab}
                    >
                      <TabList className="workspace-sidebar-panel__tabs">
                        <Tab className="workspace-sidebar-panel__tab" value="files">
                          <span>{t("file.title")}</span>
                        </Tab>
                        <Tab className="workspace-sidebar-panel__tab" value="git">
                          <span>{t("label.git")}</span>
                        </Tab>
                      </TabList>
                    </Tabs>
                  }
                  actions={
                    <div className="workspace-sidebar-panel__actions">
                      {sidebarTab === "files" ? (
                        <>
                          <Tooltip content={t("file.new_file")}>
                            <IconButton
                              className="panel-toolbar-btn"
                              aria-label={t("file.new_file")}
                              icon={<ThemedIcon semantic="file.action.new" size={14} />}
                              onClick={handleOpenFileCreate}
                              size="sm"
                            />
                          </Tooltip>
                          <Tooltip content={t("file.new_folder")}>
                            <IconButton
                              className="panel-toolbar-btn"
                              aria-label={t("file.new_folder")}
                              icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
                              onClick={handleOpenFolderCreate}
                              size="sm"
                            />
                          </Tooltip>
                          <Tooltip content={t("file.collapse_all")}>
                            <IconButton
                              className="panel-toolbar-btn"
                              aria-label={t("file.collapse_all")}
                              icon={<ChevronsUp size={14} />}
                              onClick={() => setFileTreeCollapseVersion((value) => value + 1)}
                              size="sm"
                            />
                          </Tooltip>
                        </>
                      ) : null}
                    </div>
                  }
                />

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
          <div className="workspace-main-stage">
            {mainAreaMode === "diff" ? (
              <GitDiffViewer workspaceId={workspace.id} onClose={handleCloseDiff} />
            ) : mainAreaMode === "editor" ? (
              <CodeEditorHost />
            ) : (
              <div className="agent-panes">
                <AgentPanes hydrateSessions={false} />
              </div>
            )}
          </div>

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
        align="start"
        workspaceId={workspace.id}
        gitState={gitState}
        onOpenBranchSwitcher={handleOpenBranchSwitcher}
      />
    </div>
  );
};

export { WorkspaceDesktopView as WorkspacePage };
export default WorkspaceDesktopView;
