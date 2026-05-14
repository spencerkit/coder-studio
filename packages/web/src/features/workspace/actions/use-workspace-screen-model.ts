import type { GitStatus, Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
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
import { collectSessionIds } from "../../agent-panes/pane-layout-tree";
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  focusModeAtom,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from "../atoms";
import { useWorkspaceLayoutActions } from "./use-workspace-layout-actions";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

export type WorkspaceSidebarTab = "files" | "git";
export type WorkspaceMainAreaMode = "agent" | "editor" | "diff";
export type MobileWorkspaceSheetKind = "files" | "terminal" | "supervisor" | null;
export type MobileFilesRoute =
  | { kind: "root" }
  | { kind: "editor"; path: string }
  | { kind: "diff"; path: string };

export interface WorkspaceCreateRequest {
  id: number;
  mode: "file" | "folder";
  baseDir: string | null;
}

function resolvePreferredMobileSessionId(
  orderedSessions: Session[],
  globalTargetSessionId: string | null,
  workspaceUiStateSessionId: string | null
) {
  if (
    globalTargetSessionId &&
    orderedSessions.some((session) => session.id === globalTargetSessionId)
  ) {
    return globalTargetSessionId;
  }

  if (
    workspaceUiStateSessionId &&
    orderedSessions.some((session) => session.id === workspaceUiStateSessionId)
  ) {
    return workspaceUiStateSessionId;
  }

  const mostRecentSession = [...orderedSessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt
  )[0];

  return mostRecentSession?.id ?? orderedSessions[0]?.id ?? null;
}

export function useWorkspaceScreenModel() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceId = workspace?.id ?? "__workspace_placeholder__";
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const focusMode = useAtomValue(focusModeAtom);
  const terminalPanelVisible = useAtomValue(terminalPanelVisibleAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const { sessions, paneLayout } = useWorkspaceSessions(workspace);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setBranchQuickPick = useSetAtom(branchQuickPickAtom);
  const store = useStore();
  const layout = useWorkspaceLayoutActions();
  const paneActions = usePaneActions(workspaceId);
  const sessionActions = useSessionActions();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const lastViewedTarget = useAtomValue(lastViewedTargetAtom);

  const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>("files");
  const [createRequest, setCreateRequest] = useState<WorkspaceCreateRequest | null>(null);
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);
  const [mobileSheet, setMobileSheet] = useState<MobileWorkspaceSheetKind>(null);
  const [mobileFilesRoute, setMobileFilesRoute] = useState<MobileFilesRoute>({ kind: "root" });
  const [mobileActiveSessionId, setMobileActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) {
      setActiveWorkspaceId(null);
      return;
    }

    setActiveWorkspaceId(workspace.id);

    return () => {
      setActiveWorkspaceId((current) => (current === workspace.id ? null : current));
    };
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

    setSidebarTab("git");
    setBranchQuickPick({
      visible: true,
      workspaceId: workspace.id,
      inputValue: "",
    });
  }, [setBranchQuickPick, workspace]);

  const handleOpenFileCreate = useCallback(() => {
    setCreateRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mode: "file",
      baseDir: null,
    }));
  }, []);

  const handleOpenFolderCreate = useCallback(() => {
    setCreateRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mode: "folder",
      baseDir: null,
    }));
  }, []);

  const handleConsumeCreateRequest = useCallback(() => {
    setCreateRequest(null);
  }, []);

  const handleRefreshSidebarPanel = useCallback(() => {
    setPanelRefreshToken((previous) => previous + 1);
  }, []);

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

  const preferredSessionId = workspace?.uiState?.activeSessionId ?? null;
  const preferredGlobalSessionId =
    lastViewedTarget?.workspaceId === workspace?.id ? (lastViewedTarget.sessionId ?? null) : null;

  useEffect(() => {
    if (orderedSessions.some((session) => session.id === mobileActiveSessionId)) {
      return;
    }

    setMobileActiveSessionId(
      resolvePreferredMobileSessionId(orderedSessions, preferredGlobalSessionId, preferredSessionId)
    );
  }, [mobileActiveSessionId, orderedSessions, preferredGlobalSessionId, preferredSessionId]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    if (mobileActiveSessionId === null && workspace.uiState.activeSessionId) {
      return;
    }

    const nextActiveSessionId = mobileActiveSessionId ?? undefined;
    if (workspace.uiState.activeSessionId === nextActiveSessionId) {
      return;
    }

    void persistUiState({ activeSessionId: nextActiveSessionId });
  }, [mobileActiveSessionId, persistUiState, workspace]);

  const activeSession =
    orderedSessions.find((session) => session.id === mobileActiveSessionId) ?? null;

  const selectMobileSession = useCallback(
    (sessionId: string | null) => {
      if (
        sessionId &&
        !orderedSessions.some((session) => session.id === sessionId) &&
        sessions.some((session) => session.id === sessionId && session.state !== "draft")
      ) {
        paneActions.appendSession(sessionId, mobileActiveSessionId, "vertical");
      }

      setMobileActiveSessionId(sessionId);
    },
    [mobileActiveSessionId, orderedSessions, paneActions, sessions]
  );

  const handleMobileSessionCreated = useCallback(
    (sessionId: string) => {
      paneActions.appendSession(sessionId, mobileActiveSessionId, "vertical");
      setMobileActiveSessionId(sessionId);
    },
    [mobileActiveSessionId, paneActions]
  );

  const closeMobileSession = useCallback(
    async (sessionId: string) => {
      paneActions.closeSessionPane(sessionId);
      await sessionActions.closeSession(sessionId);

      setMobileActiveSessionId((current) => {
        if (current !== sessionId) {
          return current;
        }

        const remainingSessions = orderedSessions.filter((session) => session.id !== sessionId);
        return remainingSessions[0]?.id ?? null;
      });
    },
    [orderedSessions, paneActions, sessionActions]
  );

  const openMobileSheet = useCallback((sheet: Exclude<MobileWorkspaceSheetKind, null>) => {
    setMobileSheet(sheet);
    if (sheet !== "files") {
      setMobileFilesRoute({ kind: "root" });
    }
  }, []);

  const closeMobileSheet = useCallback(() => {
    setMobileSheet(null);
    setMobileFilesRoute({ kind: "root" });
  }, []);

  const updateMobileFilesRoute = useCallback((route: MobileFilesRoute) => {
    setMobileFilesRoute(route);
  }, []);

  const mainAreaMode: WorkspaceMainAreaMode =
    sidebarTab === "git" && diffPreview ? "diff" : activeFilePath ? "editor" : "agent";

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
    closeMobileSession,
    selectMobileSession,
    sessions,
    setSidebarTab,
    sidebarCollapsed,
    sidebarTab,
    closeMobileSheet,
    terminalPanelVisible,
    updateMobileFilesRoute,
    workspace,
    workspaces,
    workspaceId,
    ...layout,
  };
}
