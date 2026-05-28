import type { GitStatus, Session } from "@coder-studio/core";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { atomFamily } from "jotai-family";
import { useCallback, useEffect, useMemo } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  orderedWorkspacesAtom,
  resolvedActiveWorkspaceIdAtom,
} from "../../../atoms/workspaces";
import { usePaneActions } from "../../agent-panes/actions/use-pane-actions";
import { useSessionActions } from "../../agent-panes/actions/use-session-actions";
import { useWorkspaceSessions } from "../../agent-panes/actions/use-workspace-sessions";
import { activeEditorPaneIdAtomFamily } from "../../agent-panes/atoms/editor-panes";
import { collectSessionIds, paneLayoutHasEditorPaneId } from "../../agent-panes/pane-layout-tree";
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  desktopSidebarViewAtom,
  focusModeAtom,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from "../atoms";
import { useWorkspaceLayoutActions } from "./use-workspace-layout-actions";

export type WorkspaceMainAreaMode = "agent" | "editor";
export type MobileWorkspaceSheetKind = "files" | "terminal" | "supervisor" | null;
export type MobileWorkspaceSidebarView = "explorer" | "search" | "source-control";
export type MobileFilesRoute =
  | { kind: "root" }
  | {
      kind: "detail";
      path?: string;
      title?: string;
    };

export interface WorkspaceCreateRequest {
  id: number;
  mode: "file" | "folder";
  baseDir: string | null;
}

interface WorkspaceScreenState {
  createRequest: WorkspaceCreateRequest | null;
  panelRefreshToken: number;
  mobileSheet: MobileWorkspaceSheetKind;
  mobileFilesRoute: MobileFilesRoute;
  mobileActiveSessionId: string | null;
  mobileSelectionVersion: number;
}

function createRootMobileFilesRoute(): MobileFilesRoute {
  return { kind: "root" };
}

function createInitialWorkspaceScreenState(): WorkspaceScreenState {
  return {
    createRequest: null,
    panelRefreshToken: 0,
    mobileSheet: null,
    mobileFilesRoute: createRootMobileFilesRoute(),
    mobileActiveSessionId: null,
    mobileSelectionVersion: 0,
  };
}

const workspaceScreenStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<WorkspaceScreenState>(createInitialWorkspaceScreenState())
);

export function useWorkspaceScreenModel() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceId = workspace?.id ?? "__workspace_placeholder__";
  const screenStateAtom = workspaceScreenStateAtomFamily(workspaceId);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const activeEditorPaneId = useAtomValue(activeEditorPaneIdAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const focusMode = useAtomValue(focusModeAtom);
  const terminalPanelVisible = useAtomValue(terminalPanelVisibleAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const desktopSidebarView = useAtomValue(desktopSidebarViewAtom);
  const { sessions, paneLayout } = useWorkspaceSessions(workspace);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setBranchQuickPick = useSetAtom(branchQuickPickAtom);
  const screenState = useAtomValue(screenStateAtom);
  const setScreenState = useSetAtom(screenStateAtom);
  const store = useStore();
  const layout = useWorkspaceLayoutActions(workspaceId);
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const { createRequest, mobileActiveSessionId, mobileFilesRoute, mobileSheet, panelRefreshToken } =
    screenState;

  useEffect(() => {
    if (!workspace) {
      setActiveWorkspaceId(null);
      return;
    }

    setActiveWorkspaceId(workspace.id);
  }, [setActiveWorkspaceId, workspace]);

  useEffect(() => {
    if (!workspace || gitState) {
      return;
    }

    let cancelled = false;

    dispatch<GitStatus>("git.status", { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          return;
        }

        store.set(gitStateAtomFamily(workspace.id), result.data);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load git status:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, gitState, store, workspace]);

  const handleOpenBranchSwitcher = useCallback(() => {
    if (!workspace) {
      return;
    }

    store.set(desktopSidebarViewAtom, "source-control");
    setBranchQuickPick({
      visible: true,
      workspaceId: workspace.id,
      inputValue: "",
    });
  }, [setBranchQuickPick, store, workspace]);

  const handleOpenFileCreate = useCallback(() => {
    setScreenState((previous) => ({
      ...previous,
      createRequest: {
        id: (previous.createRequest?.id ?? 0) + 1,
        mode: "file",
        baseDir: null,
      },
    }));
  }, [setScreenState]);

  const handleOpenFolderCreate = useCallback(() => {
    setScreenState((previous) => ({
      ...previous,
      createRequest: {
        id: (previous.createRequest?.id ?? 0) + 1,
        mode: "folder",
        baseDir: null,
      },
    }));
  }, [setScreenState]);

  const handleConsumeCreateRequest = useCallback(() => {
    setScreenState((current) =>
      current.createRequest === null
        ? current
        : {
            ...current,
            createRequest: null,
          }
    );
  }, [setScreenState]);

  const handleRefreshSidebarPanel = useCallback(() => {
    setScreenState((previous) => ({
      ...previous,
      panelRefreshToken: previous.panelRefreshToken + 1,
    }));
  }, [setScreenState]);

  const orderedSessions = useMemo(() => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    return Array.from(new Set(collectSessionIds(paneLayout)))
      .map((sessionId) => sessionMap.get(sessionId))
      .filter((session): session is NonNullable<typeof session> => Boolean(session));
  }, [paneLayout, sessions]);

  const mobileAgentSessions = useMemo(() => {
    const orderedSessionIds = new Set(orderedSessions.map((session) => session.id));
    return [
      ...orderedSessions,
      ...sessions.filter(
        (session) => session.state !== "draft" && !orderedSessionIds.has(session.id)
      ),
    ];
  }, [orderedSessions, sessions]);

  const activeSession =
    mobileAgentSessions.find((session) => session.id === mobileActiveSessionId) ?? null;

  const selectMobileSession = useCallback(
    (sessionId: string | null) => {
      if (
        sessionId &&
        !orderedSessions.some((session) => session.id === sessionId) &&
        sessions.some((session) => session.id === sessionId && session.state !== "draft")
      ) {
        paneActions.appendSessionToMobileColumn(sessionId);
      }

      setScreenState((current) => ({
        ...current,
        mobileSelectionVersion: current.mobileSelectionVersion + 1,
        mobileActiveSessionId: sessionId,
      }));
    },
    [mobileActiveSessionId, orderedSessions, paneActions, sessions, setScreenState]
  );

  const handleMobileSessionCreated = useCallback(
    (sessionId: string) => {
      paneActions.appendSessionToMobileColumn(sessionId);
      setScreenState((current) => ({
        ...current,
        mobileSelectionVersion: current.mobileSelectionVersion + 1,
        mobileActiveSessionId: sessionId,
      }));
    },
    [paneActions, setScreenState]
  );

  const closeMobileSession = useCallback(
    async (sessionId: string) => {
      const wasActive = mobileActiveSessionId === sessionId;
      const selectionVersionAtCloseStart = store.get(screenStateAtom).mobileSelectionVersion;
      const remainingSessions = mobileAgentSessions.filter((session) => session.id !== sessionId);
      const nextActiveSessionId = remainingSessions[0]?.id ?? null;

      if (wasActive) {
        setScreenState((current) =>
          current.mobileActiveSessionId === sessionId
            ? {
                ...current,
                mobileActiveSessionId: nextActiveSessionId,
              }
            : current
        );
      }

      const closed = await sessionActions.closeSession(sessionId, "remove");
      if (!closed) {
        if (
          !wasActive ||
          store.get(screenStateAtom).mobileSelectionVersion !== selectionVersionAtCloseStart
        ) {
          return;
        }

        setScreenState((current) =>
          current.mobileActiveSessionId === nextActiveSessionId
            ? {
                ...current,
                mobileActiveSessionId: sessionId,
              }
            : current
        );
        return;
      }

      setScreenState((current) => ({
        ...current,
        mobileSelectionVersion: current.mobileSelectionVersion + 1,
      }));
    },
    [
      mobileActiveSessionId,
      mobileAgentSessions,
      screenStateAtom,
      sessionActions,
      setScreenState,
      store,
    ]
  );

  const restoreMobileSession = useCallback(
    (sessionId: string | null) => {
      if (
        sessionId &&
        !orderedSessions.some((session) => session.id === sessionId) &&
        sessions.some((session) => session.id === sessionId && session.state !== "draft")
      ) {
        paneActions.appendSessionToMobileColumn(sessionId);
      }

      setScreenState((current) => ({
        ...current,
        mobileSelectionVersion: current.mobileSelectionVersion + 1,
        mobileActiveSessionId: sessionId,
      }));
    },
    [orderedSessions, paneActions, sessions, setScreenState]
  );

  const openMobileSheet = useCallback(
    (sheet: Exclude<MobileWorkspaceSheetKind, null>) => {
      setScreenState((current) => ({
        ...current,
        mobileSheet: sheet,
        mobileFilesRoute:
          sheet === "files" ? current.mobileFilesRoute : createRootMobileFilesRoute(),
      }));
    },
    [setScreenState]
  );

  const closeMobileSheet = useCallback(() => {
    setScreenState((current) => ({
      ...current,
      mobileSheet: null,
      mobileFilesRoute: createRootMobileFilesRoute(),
    }));
  }, [setScreenState]);

  const updateMobileFilesRoute = useCallback(
    (route: MobileFilesRoute) => {
      setScreenState((current) => ({
        ...current,
        mobileFilesRoute: route,
      }));
    },
    [setScreenState]
  );

  const hasActiveEditorPaneTarget =
    Boolean(activeFilePath) &&
    Boolean(activeEditorPaneId) &&
    paneLayoutHasEditorPaneId(paneLayout, activeEditorPaneId);

  const mainAreaMode: WorkspaceMainAreaMode = hasActiveEditorPaneTarget
    ? "agent"
    : activeFilePath ||
        diffPreview?.kind === "commit-file-list" ||
        diffPreview?.kind === "commit-file-diff"
      ? "editor"
      : "agent";

  return {
    activeSession,
    activeFilePath,
    activeWorkspaceId,
    createRequest,
    diffPreview,
    focusMode,
    gitState,
    handleConsumeCreateRequest,
    handleOpenBranchSwitcher,
    handleOpenFileCreate,
    handleOpenFolderCreate,
    handleRefreshSidebarPanel,
    handleMobileSessionCreated,
    mainAreaMode,
    mobileActiveSessionId,
    mobileAgentSessions,
    mobileFilesRoute,
    mobileSheet,
    openMobileSheet,
    orderedSessions,
    paneLayout,
    panelRefreshToken,
    paneLayout,
    closeMobileSession,
    restoreMobileSession,
    selectMobileSession,
    sessions,
    desktopSidebarView,
    setDesktopSidebarView: (view: typeof desktopSidebarView) =>
      store.set(desktopSidebarViewAtom, view),
    sidebarCollapsed,
    closeMobileSheet,
    terminalPanelVisible,
    updateMobileFilesRoute,
    workspace,
    workspaces,
    workspaceId,
    ...layout,
  };
}
