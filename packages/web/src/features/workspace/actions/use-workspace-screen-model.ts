import type { GitStatus, Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export type WorkspaceSidebarTab = "files" | "git";
export type WorkspaceMainAreaMode = "agent" | "editor";
export type MobileWorkspaceSheetKind = "files" | "terminal" | "supervisor" | null;
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

  const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>("files");
  const [createRequest, setCreateRequest] = useState<WorkspaceCreateRequest | null>(null);
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);
  const [mobileSheet, setMobileSheet] = useState<MobileWorkspaceSheetKind>(null);
  const [mobileFilesRoute, setMobileFilesRoute] = useState<MobileFilesRoute>({ kind: "root" });
  const [mobileActiveSessionId, setMobileActiveSessionId] = useState<string | null>(null);
  const mobileSelectionVersionRef = useRef(0);

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

  const activeSession =
    mobileAgentSessions.find((session) => session.id === mobileActiveSessionId) ?? null;

  const selectMobileSession = useCallback(
    (sessionId: string | null) => {
      if (
        sessionId &&
        !orderedSessions.some((session) => session.id === sessionId) &&
        sessions.some((session) => session.id === sessionId && session.state !== "draft")
      ) {
        paneActions.appendSession(sessionId, mobileActiveSessionId, "vertical");
      }

      mobileSelectionVersionRef.current += 1;
      setMobileActiveSessionId(sessionId);
    },
    [mobileActiveSessionId, orderedSessions, paneActions, sessions]
  );

  const handleMobileSessionCreated = useCallback(
    (sessionId: string) => {
      paneActions.appendSession(sessionId, mobileActiveSessionId, "vertical");
      mobileSelectionVersionRef.current += 1;
      setMobileActiveSessionId(sessionId);
    },
    [mobileActiveSessionId, paneActions]
  );

  const closeMobileSession = useCallback(
    async (sessionId: string) => {
      const wasActive = mobileActiveSessionId === sessionId;
      const selectionVersionAtCloseStart = mobileSelectionVersionRef.current;
      const remainingSessions = mobileAgentSessions.filter((session) => session.id !== sessionId);
      const nextActiveSessionId = remainingSessions[0]?.id ?? null;

      if (wasActive) {
        setMobileActiveSessionId(nextActiveSessionId);
      }

      const closed = await sessionActions.closeSession(sessionId, "remove");
      if (!closed) {
        if (!wasActive || mobileSelectionVersionRef.current !== selectionVersionAtCloseStart) {
          return;
        }

        setMobileActiveSessionId((current) =>
          current === nextActiveSessionId ? sessionId : current
        );
        return;
      }

      mobileSelectionVersionRef.current += 1;
    },
    [mobileActiveSessionId, mobileAgentSessions, sessionActions]
  );

  const restoreMobileSession = useCallback(
    (sessionId: string | null) => {
      if (
        sessionId &&
        !orderedSessions.some((session) => session.id === sessionId) &&
        sessions.some((session) => session.id === sessionId && session.state !== "draft")
      ) {
        paneActions.appendSession(sessionId, mobileActiveSessionId, "vertical");
      }

      mobileSelectionVersionRef.current += 1;
      setMobileActiveSessionId(sessionId);
    },
    [mobileActiveSessionId, orderedSessions, paneActions, sessions]
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
    activeFilePath || diffPreview?.source === "commit" ? "editor" : "agent";

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
