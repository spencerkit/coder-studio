import { useSetAtom } from "jotai";
import { type FC, useEffect, useRef } from "react";
import { EmptyState } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { AgentPanes } from "../../../agent-panes";
import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
import { PanelHeader } from "../../../shared/components/panel-header";
import { TerminalPanel } from "../../../terminal-panel";
import { TopBar } from "../../../topbar";
import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
import { sidebarCollapsedAtom } from "../../atoms";
import { sanitizeDesktopSidebarView } from "../../atoms/layout";
import { ExplorerPanel } from "../shared/explorer-panel";
import { GitPanel } from "../shared/git-panel";
import { SearchPanel } from "../shared/search-panel";
import { WorkspaceActivityBar } from "../shared/workspace-activity-bar";
import { WorkspaceStatusBar } from "../shared/workspace-status-bar";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export const WorkspaceDesktopView: FC = () => {
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const fullscreenController = useWorkspaceFullscreen(fullscreenRootRef);
  const t = useTranslation();
  const {
    createRequest,
    desktopSidebarView,
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
    setDesktopSidebarView,
    sidebarCollapsed,
    terminalPanelVisible,
    workspace,
    bottomPanelHeight,
    bottomPanelRef,
  } = useWorkspaceScreenModel();
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const activeSidebarView = sanitizeDesktopSidebarView(desktopSidebarView);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

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
        setDesktopSidebarView("explorer");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        setDesktopSidebarView("search");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        setDesktopSidebarView("source-control");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDesktopSidebarView, setSidebarCollapsed]);

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
                <WorkspaceActivityBar
                  activeView={activeSidebarView}
                  onSelectView={setDesktopSidebarView}
                />

                <div className="workspace-sidebar-panel__content">
                  {activeSidebarView === "explorer" ? (
                    <ExplorerPanel
                      workspaceId={workspace.id}
                      createRequest={createRequest}
                      onCreateRequestConsumed={handleConsumeCreateRequest}
                      onOpenFileCreate={handleOpenFileCreate}
                      onOpenFolderCreate={handleOpenFolderCreate}
                    />
                  ) : null}

                  {activeSidebarView === "search" ? (
                    <SearchPanel workspaceId={workspace.id} />
                  ) : null}

                  {activeSidebarView === "source-control" ? (
                    <div className="workspace-sidebar-view">
                      <PanelHeader title={t("workspace.sidebar.source_control")} />
                      <div className="workspace-sidebar-panel__body">
                        <GitPanel workspaceId={workspace.id} variant="desktop" />
                      </div>
                    </div>
                  ) : null}
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
            {mainAreaMode === "editor" ? (
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
