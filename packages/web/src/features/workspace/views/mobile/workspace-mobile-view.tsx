import { useAtomValue, useSetAtom } from "jotai";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  lastViewedTargetAtom,
  pendingFocusSessionAtom,
  visibleMobileSessionIdAtom,
} from "../../../../atoms/app-ui";
import { Sheet } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { SessionCard } from "../../../agent-panes/views/shared/session-card";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import { CodeEditorHeaderActions } from "../../../code-editor/views/shared/code-editor-host";
import { supervisorDetailsAtom, supervisorDialogAtom } from "../../../supervisor/atoms";
import { MobileSupervisorSheet } from "../../../supervisor/views/mobile/mobile-supervisor-sheet";
import { TerminalPanel } from "../../../terminal-panel";
import type { CreateRequest } from "../../actions/use-file-actions";
import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
import {
  type MobileWorkspaceSidebarView,
  useWorkspaceScreenModel,
} from "../../actions/use-workspace-screen-model";
import { useWorkspaceUiStatePersistence } from "../../actions/use-workspace-ui-state-persistence";
import { WorkspaceLaunchModal } from "../shared/workspace-launch-modal";
import { WorkspaceStatusBar } from "../shared/workspace-status-bar";
import { useMobileLayoutMode } from "./hooks/use-mobile-layout-mode";
import { useMobileMotionMode } from "./hooks/use-mobile-motion-mode";
import { useVisualViewportInset } from "./hooks/use-visual-viewport-inset";
import { MobileAgentSheet } from "./mobile-agent-sheet";
import { MobileDock } from "./mobile-dock";
import { MobileFilesSheet } from "./mobile-files-sheet";
import { MobileTopBar } from "./mobile-topbar";
import { MobileWorkspaceDrawer } from "./mobile-workspace-drawer";

function resolvePreferredMobileSessionId(
  sessionIdsInLayout: string[],
  orderedSessions: Array<{ id: string; lastActiveAt: number }>,
  mobileAgentSessions: Array<{ id: string; lastActiveAt: number }>,
  globalTargetSessionId: string | null,
  workspaceUiStateSessionId: string | null
) {
  const displayableSessionIds = new Set(mobileAgentSessions.map((session) => session.id));
  const sessionIdsInLayoutSet = new Set(sessionIdsInLayout);

  if (globalTargetSessionId && displayableSessionIds.has(globalTargetSessionId)) {
    return {
      sessionId: globalTargetSessionId,
      missingFromLayout: !sessionIdsInLayoutSet.has(globalTargetSessionId),
    };
  }

  if (workspaceUiStateSessionId && displayableSessionIds.has(workspaceUiStateSessionId)) {
    return {
      sessionId: workspaceUiStateSessionId,
      missingFromLayout: !sessionIdsInLayoutSet.has(workspaceUiStateSessionId),
    };
  }

  const mostRecentSession = [...orderedSessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt
  )[0];
  const fallbackSessionId = mostRecentSession?.id ?? orderedSessions[0]?.id ?? null;

  return {
    sessionId: fallbackSessionId,
    missingFromLayout: fallbackSessionId ? !sessionIdsInLayoutSet.has(fallbackSessionId) : false,
  };
}

export function WorkspaceMobileView() {
  const fullscreenRootRef = useRef<HTMLDivElement>(null);
  const restoredWorkspaceIdRef = useRef<string | null>(null);
  const lastPersistedSessionIdRef = useRef<string | null>(null);
  const fullscreenController = useWorkspaceFullscreen(fullscreenRootRef);
  const t = useTranslation();
  const navigate = useNavigate();
  const pendingFocusSessionId = useAtomValue(pendingFocusSessionAtom);
  const lastViewedTarget = useAtomValue(lastViewedTargetAtom);
  const setVisibleMobileSessionId = useSetAtom(visibleMobileSessionIdAtom);
  const supervisorDetails = useAtomValue(supervisorDetailsAtom);
  const supervisorDialog = useAtomValue(supervisorDialogAtom);
  const {
    activeSession,
    activeWorkspaceId,
    closeMobileSession,
    closeMobileSheet,
    diffPreview,
    handleMobileSessionCreated,
    handleOpenBranchSwitcher,
    gitState,
    mobileActiveSessionId,
    mobileAgentSessions,
    mobileFilesRoute,
    mobileSheet,
    openMobileSheet,
    orderedSessions,
    restoreMobileSession,
    selectMobileSession,
    updateMobileFilesRoute,
    workspace,
    workspaces,
  } = useWorkspaceScreenModel();
  const { persistUiState } = useWorkspaceUiStatePersistence(
    activeWorkspaceId ?? "__workspace_empty__"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [mobileFilesView, setMobileFilesView] = useState<MobileWorkspaceSidebarView>("explorer");
  const [mobileFileCreateRequest, setMobileFileCreateRequest] = useState<CreateRequest | null>(
    null
  );
  const [mobileFileCollapseVersion, setMobileFileCollapseVersion] = useState(0);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const [mobileTerminalHeaderAction, setMobileTerminalHeaderAction] = useState<ReactNode>(null);
  const keyboardInset = useVisualViewportInset();
  const layoutMode = useMobileLayoutMode();
  const motionMode = useMobileMotionMode();
  const mobileEditorState = useCodeEditorActions();

  const preferredSessionId = workspace?.uiState?.activeSessionId ?? null;
  const preferredGlobalSessionId =
    lastViewedTarget?.workspaceId === workspace?.id ? (lastViewedTarget.sessionId ?? null) : null;

  useEffect(() => {
    if (!workspace) {
      return;
    }

    if (restoredWorkspaceIdRef.current === workspace.id) {
      return;
    }

    if (mobileAgentSessions.length === 0 && orderedSessions.length === 0) {
      return;
    }

    const sessionIdsInLayout = orderedSessions.map((session) => session.id);

    const preferred = resolvePreferredMobileSessionId(
      sessionIdsInLayout,
      orderedSessions,
      mobileAgentSessions,
      preferredGlobalSessionId,
      preferredSessionId
    );

    if (!preferred.sessionId) {
      restoredWorkspaceIdRef.current = workspace.id;
      return;
    }

    restoredWorkspaceIdRef.current = workspace.id;

    if (preferred.missingFromLayout) {
      restoreMobileSession(preferred.sessionId);
      return;
    }

    if (preferred.sessionId !== mobileActiveSessionId) {
      restoreMobileSession(preferred.sessionId);
    }
  }, [
    mobileActiveSessionId,
    mobileAgentSessions,
    orderedSessions,
    preferredGlobalSessionId,
    preferredSessionId,
    restoreMobileSession,
    workspace,
  ]);

  useEffect(() => {
    if (!workspace) {
      restoredWorkspaceIdRef.current = null;
      lastPersistedSessionIdRef.current = null;
      return;
    }

    if (!mobileActiveSessionId) {
      return;
    }

    if (lastPersistedSessionIdRef.current === mobileActiveSessionId) {
      return;
    }

    lastPersistedSessionIdRef.current = mobileActiveSessionId;
    if (workspace.uiState.activeSessionId === mobileActiveSessionId) {
      return;
    }

    void persistUiState({ activeSessionId: mobileActiveSessionId });
  }, [mobileActiveSessionId, persistUiState, workspace]);

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

  useEffect(() => {
    if (!activeSession || mobileSheet === "supervisor") {
      return;
    }

    const shouldOpenSupervisorSheet =
      (supervisorDetails.open && supervisorDetails.sessionId === activeSession.id) ||
      (supervisorDialog.open && supervisorDialog.sessionId === activeSession.id);

    if (!shouldOpenSupervisorSheet) {
      return;
    }

    setAgentSheetOpen(false);
    openMobileSheet("supervisor");
  }, [
    activeSession,
    mobileSheet,
    openMobileSheet,
    supervisorDetails.open,
    supervisorDetails.sessionId,
    supervisorDialog.open,
    supervisorDialog.sessionId,
  ]);

  useEffect(() => {
    if (mobileSheet !== "files" || mobileFilesRoute.kind !== "detail") {
      return;
    }

    const isCommitDetailRoute =
      (diffPreview?.kind === "commit-file-list" || diffPreview?.kind === "commit-file-diff") &&
      mobileFilesRoute.path === diffPreview.path &&
      mobileFilesRoute.title === diffPreview.title;

    if (isCommitDetailRoute) {
      return;
    }

    if (mobileEditorState.activeFilePath) {
      if (
        mobileFilesRoute.path !== mobileEditorState.activeFilePath ||
        mobileFilesRoute.title !== undefined
      ) {
        updateMobileFilesRoute({
          kind: "detail",
          path: mobileEditorState.activeFilePath,
        });
      }
      return;
    }

    if (diffPreview?.kind === "commit-file-list" || diffPreview?.kind === "commit-file-diff") {
      if (
        mobileFilesRoute.path !== diffPreview.path ||
        mobileFilesRoute.title !== diffPreview.title
      ) {
        updateMobileFilesRoute({
          kind: "detail",
          path: diffPreview.path,
          title: diffPreview.title,
        });
      }
      return;
    }

    closeMobileSheet();
  }, [
    closeMobileSheet,
    diffPreview,
    mobileEditorState.activeFilePath,
    mobileFilesRoute,
    mobileSheet,
    updateMobileFilesRoute,
  ]);

  const filesSheetKicker = mobileFilesRoute.kind === "detail" ? t("file.title") : null;

  const handleMobileCreateRequest = (mode: "file" | "folder") => {
    setMobileFileCreateRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mode,
      baseDir: null,
    }));
  };

  const filesSheetHeaderAction =
    mobileFilesRoute.kind === "detail" ? (
      <CodeEditorHeaderActions state={mobileEditorState} variant="mobile" />
    ) : null;

  const sheetBody =
    mobileSheet === "files"
      ? {
          title:
            mobileFilesRoute.kind === "detail"
              ? (mobileFilesRoute.title ??
                mobileFilesRoute.path?.split("/").pop() ??
                t("mobile.files.editor_fallback"))
              : mobileFilesView === "explorer"
                ? t("workspace.sidebar.explorer")
                : mobileFilesView === "search"
                  ? t("workspace.sidebar.search")
                  : t("workspace.sidebar.source_control"),
          body: activeWorkspaceId ? (
            <MobileFilesSheet
              workspaceId={activeWorkspaceId}
              route={mobileFilesRoute}
              activeView={mobileFilesView}
              createRequest={mobileFileCreateRequest}
              onCreateRequestConsumed={() => setMobileFileCreateRequest(null)}
              collapseVersion={mobileFileCollapseVersion}
              onCreateFile={() => handleMobileCreateRequest("file")}
              onCreateFolder={() => handleMobileCreateRequest("folder")}
              onCollapseAll={() => setMobileFileCollapseVersion((value) => value + 1)}
              onRouteChange={updateMobileFilesRoute}
              onTabChange={setMobileFilesView}
              onCloseSheet={closeMobileSheet}
              editorState={mobileEditorState}
            />
          ) : null,
          footer: activeWorkspaceId ? (
            <WorkspaceStatusBar
              workspaceId={activeWorkspaceId}
              gitState={gitState}
              onOpenBranchSwitcher={handleOpenBranchSwitcher}
              flush
            />
          ) : null,
          kicker: filesSheetKicker,
          onBack:
            mobileFilesRoute.kind === "root"
              ? undefined
              : diffPreview?.kind === "commit-file-list" || diffPreview?.kind === "commit-file-diff"
                ? () => void mobileEditorState.handleClose()
                : () => updateMobileFilesRoute({ kind: "root" }),
          backLabel: t("action.back"),
          headerAction: filesSheetHeaderAction,
          fullscreen: true,
          bodyClassName: "mobile-sheet__body--flush mobile-sheet__body--fullscreen",
          contentClassName: "mobile-sheet--files",
        }
      : mobileSheet === "terminal"
        ? {
            title: t("label.terminal"),
            body: (
              <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
                <TerminalPanel
                  chrome="mobile-fullscreen"
                  onMobileHeaderActionsChange={setMobileTerminalHeaderAction}
                />
              </div>
            ),
            footer: activeWorkspaceId ? (
              <WorkspaceStatusBar
                workspaceId={activeWorkspaceId}
                gitState={gitState}
                onOpenBranchSwitcher={handleOpenBranchSwitcher}
                flush
              />
            ) : null,
            kicker: null,
            headerAction: mobileTerminalHeaderAction,
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
      ref={fullscreenRootRef}
      className={`mobile-shell mobile-shell--${layoutMode} mobile-shell--motion-${motionMode}`}
      data-testid="mobile-shell"
      data-layout-mode={layoutMode}
      data-motion-mode={motionMode}
    >
      <MobileTopBar
        activeWorkspace={workspace}
        drawerOpen={drawerOpen}
        fullscreenController={fullscreenController}
        onOpenSettings={() => {
          setAgentSheetOpen(false);
          navigate("/settings");
        }}
        onToggleDrawer={() => {
          setAgentSheetOpen(false);
          setDrawerOpen((value) => !value);
        }}
      />

      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content">
          {orderedSessions.length > 0 ? (
            <>
              {activeSession ? (
                <section className="mobile-shell__agent-stage">
                  <SessionCard
                    sessionId={activeSession.id}
                    showHeaderActions={false}
                    showSupervisorInline={
                      activeSession.capability === "full" &&
                      activeSession.state !== "draft" &&
                      activeSession.state !== "ended"
                    }
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="mobile-shell__agent-empty" data-testid="mobile-agent-empty">
              <div className="mobile-shell__empty-content mobile-shell__empty-content--flat">
                <div className="mobile-shell__empty-state">
                  <div className="mobile-shell__empty-heading">
                    <p className="mobile-shell__empty-title">{t("mobile.empty.start_session")}</p>
                  </div>
                  <div className="mobile-shell__placeholder-copy">
                    <p>{t("mobile.empty.files_terminal_hint")}</p>
                  </div>
                  <div className="mobile-shell__empty-action-row">
                    <button
                      type="button"
                      className="mobile-shell__empty-cta"
                      onClick={() => setAgentSheetOpen(true)}
                    >
                      {t("action.create_session")}
                    </button>
                  </div>
                </div>
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
        {activeWorkspaceId ? (
          <WorkspaceStatusBar
            workspaceId={activeWorkspaceId}
            gitState={gitState}
            onOpenBranchSwitcher={handleOpenBranchSwitcher}
          />
        ) : null}
      </div>

      {agentSheetOpen ? (
        <MobileAgentSheet
          activeSessionId={mobileActiveSessionId}
          activeWorkspaceId={activeWorkspaceId}
          defaultMode={mobileAgentSessions.length === 0 ? "create" : "list"}
          sessions={mobileAgentSessions}
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
        <Sheet
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
          footer={"footer" in sheetBody ? sheetBody.footer : undefined}
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
