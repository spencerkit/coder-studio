import { useAtomValue, useSetAtom } from "jotai";
import { type CSSProperties, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pendingFocusSessionAtom, visibleMobileSessionIdAtom } from "../../../../atoms/app-ui";
import { useTranslation } from "../../../../lib/i18n";
import { SessionCard } from "../../../agent-panes/views/shared/session-card";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import { CodeEditorHeaderActions } from "../../../code-editor/views/shared/code-editor-host";
import { ConfigDriftBanner } from "../../../config-drift-banner";
import { MobileSupervisorBadge } from "../../../supervisor/views/mobile/mobile-supervisor-badge";
import { MobileSupervisorSheet } from "../../../supervisor/views/mobile/mobile-supervisor-sheet";
import { TerminalPanel } from "../../../terminal-panel";
import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
import { WorkspaceLaunchModal } from "../shared/workspace-launch-modal";
import { useMobileLayoutMode } from "./hooks/use-mobile-layout-mode";
import { useMobileMotionMode } from "./hooks/use-mobile-motion-mode";
import { useVisualViewportInset } from "./hooks/use-visual-viewport-inset";
import { MobileAgentSheet } from "./mobile-agent-sheet";
import { MobileDock } from "./mobile-dock";
import { MobileFilesSheet } from "./mobile-files-sheet";
import { MobileSheet } from "./mobile-sheet";
import { MobileTopBar } from "./mobile-topbar";
import { MobileWorkspaceDrawer } from "./mobile-workspace-drawer";

export function WorkspaceMobileView() {
  const t = useTranslation();
  const navigate = useNavigate();
  const pendingFocusSessionId = useAtomValue(pendingFocusSessionAtom);
  const setVisibleMobileSessionId = useSetAtom(visibleMobileSessionIdAtom);
  const {
    activeSession,
    activeWorkspaceId,
    closeMobileSession,
    closeMobileSheet,
    handleMobileSessionCreated,
    mobileActiveSessionId,
    mobileFilesRoute,
    mobileSheet,
    openMobileSheet,
    orderedSessions,
    selectMobileSession,
    updateMobileFilesRoute,
    workspace,
    workspaces,
  } = useWorkspaceScreenModel();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const keyboardInset = useVisualViewportInset();
  const layoutMode = useMobileLayoutMode();
  const motionMode = useMobileMotionMode();
  const mobileEditorState = useCodeEditorActions();

  useEffect(() => {
    if (!pendingFocusSessionId) {
      return;
    }

    if (pendingFocusSessionId === mobileActiveSessionId) {
      return;
    }

    if (orderedSessions.some((session) => session.id === pendingFocusSessionId)) {
      selectMobileSession(pendingFocusSessionId);
    }
  }, [mobileActiveSessionId, orderedSessions, pendingFocusSessionId, selectMobileSession]);

  useEffect(() => {
    setVisibleMobileSessionId(mobileActiveSessionId);

    return () => {
      setVisibleMobileSessionId(null);
    };
  }, [mobileActiveSessionId, setVisibleMobileSessionId]);

  const sheetBody =
    mobileSheet === "files"
      ? {
          title:
            mobileFilesRoute.kind === "editor"
              ? (mobileFilesRoute.path.split("/").pop() ?? t("mobile.files.editor_fallback"))
              : mobileFilesRoute.kind === "diff"
                ? (mobileFilesRoute.path.split("/").pop() ?? t("worktree.diff_tab"))
                : t("file.title"),
          body: activeWorkspaceId ? (
            <MobileFilesSheet
              workspaceId={activeWorkspaceId}
              route={mobileFilesRoute}
              onRouteChange={updateMobileFilesRoute}
              onCloseSheet={closeMobileSheet}
              detailBackMode="sheet"
              editorState={mobileEditorState}
            />
          ) : null,
          kicker: mobileFilesRoute.kind === "root" ? t("label.workspace") : t("file.title"),
          onBack:
            mobileFilesRoute.kind === "root"
              ? undefined
              : () => updateMobileFilesRoute({ kind: "root" }),
          backLabel: t("action.back"),
          headerAction:
            mobileFilesRoute.kind === "editor" ? (
              <CodeEditorHeaderActions state={mobileEditorState} variant="mobile" />
            ) : null,
          fullscreen: true,
          bodyClassName: "mobile-sheet__body--flush mobile-sheet__body--fullscreen",
          contentClassName: "mobile-sheet--files",
        }
      : mobileSheet === "terminal"
        ? {
            title: t("label.terminal"),
            body: (
              <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
                <TerminalPanel chrome="mobile-fullscreen" />
              </div>
            ),
            kicker: null,
            fullscreen: true,
            bodyClassName: "mobile-sheet__body--flush mobile-sheet__body--fullscreen",
            contentClassName: "mobile-sheet--terminal",
          }
        : null;

  const handleDockSelect = (item: "agent" | "files" | "terminal") => {
    if (item === "agent") {
      setAgentSheetOpen((value) => !value);
      return;
    }

    setAgentSheetOpen(false);
    openMobileSheet(item);
  };

  const activeDockItem = agentSheetOpen
    ? "agent"
    : mobileSheet === "files" || mobileSheet === "terminal"
      ? mobileSheet
      : null;

  return (
    <div
      className={`mobile-shell mobile-shell--${layoutMode} mobile-shell--motion-${motionMode}`}
      data-testid="mobile-shell"
      data-layout-mode={layoutMode}
      data-motion-mode={motionMode}
    >
      <MobileTopBar
        activeWorkspace={workspace}
        drawerOpen={drawerOpen}
        onOpenSettings={() => {
          setAgentSheetOpen(false);
          navigate("/settings");
        }}
        onToggleDrawer={() => {
          setAgentSheetOpen(false);
          setDrawerOpen((value) => !value);
        }}
      />

      <ConfigDriftBanner />

      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content">
          {orderedSessions.length > 0 ? (
            <>
              {activeSession ? (
                <section className="mobile-shell__agent-stage">
                  <SessionCard
                    sessionId={activeSession.id}
                    showHeaderActions={false}
                    showSupervisorInline={false}
                    headerAccessory={
                      <MobileSupervisorBadge
                        sessionId={activeSession.id}
                        onOpen={() => {
                          setAgentSheetOpen(false);
                          openMobileSheet("supervisor");
                        }}
                      />
                    }
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="mobile-shell__agent-empty" data-testid="mobile-agent-empty">
              <div className="mobile-shell__empty-content">
                <div className="mobile-shell__placeholder-copy">
                  <p>{t("mobile.empty.start_session")}</p>
                  <p>{t("mobile.empty.files_terminal_hint")}</p>
                </div>
                <button
                  type="button"
                  className="mobile-shell__empty-cta"
                  onClick={() => setAgentSheetOpen(true)}
                >
                  {t("action.create_session")}
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      <div
        className="mobile-shell__bottom-stack"
        data-testid="mobile-bottom-stack"
        style={{ "--mobile-keyboard-inset": `${keyboardInset}px` } as CSSProperties}
      >
        <div className="mobile-dock-shell">
          <MobileDock activeItem={activeDockItem} onSelectItem={handleDockSelect} />
        </div>
      </div>

      {agentSheetOpen ? (
        <MobileAgentSheet
          activeSessionId={mobileActiveSessionId}
          activeWorkspaceId={activeWorkspaceId}
          defaultMode={orderedSessions.length === 0 ? "create" : "list"}
          sessions={orderedSessions}
          onClose={() => setAgentSheetOpen(false)}
          onCloseSession={closeMobileSession}
          onSelectSession={selectMobileSession}
          onSessionCreated={handleMobileSessionCreated}
        />
      ) : null}

      {mobileSheet === "supervisor" && activeSession ? (
        <MobileSupervisorSheet
          sessionId={activeSession.id}
          workspaceId={activeSession.workspaceId}
          onClose={() => {
            setAgentSheetOpen(false);
            closeMobileSheet();
          }}
        />
      ) : null}

      {sheetBody ? (
        <MobileSheet
          title={sheetBody.title}
          body={sheetBody.body}
          onClose={() => {
            setAgentSheetOpen(false);
            closeMobileSheet();
          }}
          kicker={sheetBody.kicker ?? undefined}
          onBack={sheetBody.onBack}
          backLabel={sheetBody.backLabel}
          headerAction={"headerAction" in sheetBody ? sheetBody.headerAction : undefined}
          bodyClassName={sheetBody.bodyClassName}
          contentClassName={sheetBody.contentClassName}
          fullscreen={sheetBody.fullscreen}
        />
      ) : null}

      <MobileWorkspaceDrawer
        activeWorkspaceId={activeWorkspaceId}
        isOpen={drawerOpen}
        workspaces={workspaces}
        onClose={() => setDrawerOpen(false)}
        onOpenWorkspaceLauncher={() => {
          setAgentSheetOpen(false);
          setWorkspaceLaunchOpen(true);
        }}
      />

      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </div>
  );
}

export default WorkspaceMobileView;
