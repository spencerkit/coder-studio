import { useAtomValue, useSetAtom } from "jotai";
import { type FC, useEffect, useRef } from "react";
import { activeWorkspaceAtom } from "../../../../atoms/workspaces";
import { EmptyState } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { AgentPanes } from "../../../agent-panes";
import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
import { TopBar } from "../../../topbar";
import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
import { useWorkspaceNavigationShortcuts } from "../../actions/use-workspace-navigation-shortcuts";
import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
import { sidebarCollapsedAtom } from "../../atoms";
import { sanitizeDesktopSidebarView } from "../../atoms/layout";
import { AgentInstructionsSection } from "../shared/agent-instructions-section";
import { AgentTokenTrendSection } from "../shared/agent-token-trend-section";
import { ExplorerPanel } from "../shared/explorer-panel";
import { GitPanel } from "../shared/git-panel";
import { SearchPanel } from "../shared/search-panel";
import { SkillsPanel } from "../shared/skills-panel";
import { WorkspaceActivityBar } from "../shared/workspace-activity-bar";
import { WorkspaceBottomPanel } from "../shared/workspace-bottom-panel";
import { WorkspaceExtensionStatePanel } from "../shared/workspace-extension-state-panel";
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

const WorkspaceDesktopScene: FC = () => {
  const t = useTranslation();
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const fullscreenController = useWorkspaceFullscreen(fullscreenRootRef);
  const {
    createRequest,
    desktopSidebarView,
    focusMode,
    gitState,
    handleBottomPointerDown,
    handleConsumeCreateRequest,
    handleLeftPointerDown,
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
    panelRefreshToken,
  } = useWorkspaceScreenModel();
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const activeSidebarView = sanitizeDesktopSidebarView(desktopSidebarView);
  const workspaceId = workspace?.id ?? "__workspace_placeholder__";

  useWorkspaceNavigationShortcuts(workspaceId);

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
        return;
      }

      if (event.key === "4") {
        event.preventDefault();
        setDesktopSidebarView("agent-instructions");
        return;
      }

      if (event.key === "5") {
        event.preventDefault();
        setDesktopSidebarView("skills");
        return;
      }

      if (event.key === "6") {
        event.preventDefault();
        setDesktopSidebarView("extensions");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setDesktopSidebarView, setSidebarCollapsed]);

  if (!workspace) {
    return null;
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
                      refreshToken={panelRefreshToken}
                    />
                  ) : null}

                  {activeSidebarView === "search" ? (
                    <SearchPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  ) : null}

                  {activeSidebarView === "source-control" ? (
                    <div className="workspace-sidebar-view">
                      <div className="workspace-sidebar-panel__body">
                        <GitPanel
                          workspaceId={workspace.id}
                          refreshToken={panelRefreshToken}
                          variant="desktop"
                        />
                      </div>
                    </div>
                  ) : null}

                  {activeSidebarView === "agent-instructions" ? (
                    <div className="workspace-sidebar-view">
                      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
                        <AgentTokenTrendSection workspacePath={workspace.path} />
                        <AgentInstructionsSection workspaceId={workspace.id} />
                      </div>
                    </div>
                  ) : null}

                  {activeSidebarView === "skills" ? (
                    <SkillsPanel workspaceId={workspace.id} refreshToken={panelRefreshToken} />
                  ) : null}

                  {activeSidebarView === "extensions" ? (
                    <WorkspaceExtensionStatePanel workspaceId={workspace.id} />
                  ) : null}
                </div>
              </div>
            </aside>

            <div
              className="split-divider-v"
              onPointerDown={handleLeftPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("workspace.resize_left_panel")}
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
              onPointerDown={handleBottomPointerDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("workspace.resize_bottom_panel")}
            />
          )}

          {!focusMode && terminalPanelVisible && (
            <div
              ref={bottomPanelRef}
              className="workspace-bottom-panel"
              style={{ height: `${bottomPanelHeight}px` }}
            >
              <WorkspaceBottomPanel workspaceId={workspace.id} />
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

export const WorkspaceDesktopView: FC = () => {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const t = useTranslation();

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

  return <WorkspaceDesktopScene key={workspace.id} />;
};

export { WorkspaceDesktopView as WorkspacePage };
export default WorkspaceDesktopView;
