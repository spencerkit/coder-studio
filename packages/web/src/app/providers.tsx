/**
 * Application Providers
 *
 * Initializes WebSocket connection and sets up event routing.
 * Manages connection lifecycle and maps WS events to Jotai atoms.
 */

import type {
  GitBranch,
  GitStatus,
  Session,
  Supervisor,
  SupervisorCycle,
  Workspace,
  WorktreeInfo,
} from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import type { Store } from "jotai/vanilla/store";
import { useEffect, useRef } from "react";
import {
  authEnabledAtom,
  connectionErrorAtom,
  connectionStatusAtom,
  dispatchCommandAtom,
  isWriterAtom,
  lastReconnectAttemptAtom,
  reconnectAttemptCountAtom,
  serverInfoAtom,
  sessionsAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
  wsClientAtom,
} from "../atoms";
import { authenticatedAtom, themeAtom } from "../atoms/app-ui";
import type { DispatchCommand } from "../atoms/connection";
import { activeWorkspaceIdAtom } from "../atoms/workspaces";
import { useSessionNotifications } from "../features/notifications";
import { supervisorCyclesAtom, supervisorsAtom } from "../features/supervisor/atoms";
import { terminalMetaAtomFamily } from "../features/terminal-panel/atoms";
import {
  resolveTerminalCopyOnSelectSetting,
  terminalPreferencesAtom,
} from "../features/terminal-panel/preferences";
import {
  editorRefreshTokenAtomFamily,
  fileTreeStaleAtomFamily,
  gitBranchListAtomFamily,
  gitStateAtomFamily,
  worktreeListAtomFamily,
} from "../features/workspace/atoms";
import { getThemeById, resolveStoredThemeId } from "../theme";
import type { ConnectionStatus, EventListener } from "../ws";
import { resolveWsUrl, WsClient } from "../ws";

/**
 * Module-level WebSocket client singleton.
 * Prevents duplicate connections in React StrictMode.
 */
let globalWsClient: WsClient | null = null;
let pendingDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

interface WorkspaceRefreshHint {
  refreshGit: boolean;
  refreshBranches: boolean;
  refreshWorktrees: boolean;
  markTreeStale: boolean;
  refreshEditorBuffers: boolean;
}

interface WorkspaceActivityState {
  mode: "active" | "inactive";
  workspaceId: string | null;
}

const DEFAULT_REFRESH_HINT: WorkspaceRefreshHint = {
  refreshGit: false,
  refreshBranches: false,
  refreshWorktrees: false,
  markTreeStale: false,
  refreshEditorBuffers: false,
};
const FOREGROUND_RECOVERY_COOLDOWN_MS = 250;
const THEME_ID_STORAGE_KEY = "ui.themeId";
const LEGACY_THEME_STORAGE_KEY = "ui.theme";

function shouldMarkTreeStaleForFsReason(reason?: string): boolean {
  return reason === "fs_change";
}

function readStoredThemePreference(): unknown {
  const storedThemeId = localStorage.getItem(THEME_ID_STORAGE_KEY);
  if (storedThemeId !== null) {
    try {
      return JSON.parse(storedThemeId);
    } catch {
      return undefined;
    }
  }

  const legacyTheme = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (legacyTheme !== null) {
    try {
      return JSON.parse(legacyTheme);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function applyResolvedTheme(themeId: unknown): string {
  const resolvedTheme = getThemeById(resolveStoredThemeId(themeId));
  document.documentElement.setAttribute("data-theme", resolvedTheme.documentThemeAttr);
  return resolvedTheme.id;
}

export function resetAppProvidersSingletonsForTests() {
  if (pendingDisconnectTimer) {
    clearTimeout(pendingDisconnectTimer);
    pendingDisconnectTimer = null;
  }
  globalWsClient = null;
}

function mergeRefreshHints(
  current: WorkspaceRefreshHint,
  next: Partial<WorkspaceRefreshHint>
): WorkspaceRefreshHint {
  return {
    refreshGit: current.refreshGit || Boolean(next.refreshGit),
    refreshBranches: current.refreshBranches || Boolean(next.refreshBranches),
    refreshWorktrees: current.refreshWorktrees || Boolean(next.refreshWorktrees),
    markTreeStale: current.markTreeStale || Boolean(next.markTreeStale),
    refreshEditorBuffers: current.refreshEditorBuffers || Boolean(next.refreshEditorBuffers),
  };
}

function parseWorkspaceRefreshHint(
  topic: string,
  payload: unknown
): {
  workspaceId: string;
  hint: WorkspaceRefreshHint;
} | null {
  const match = topic.match(/^workspace\.([^.]+)\.(fs\.dirty|git\.state)$/);
  if (!match) {
    return null;
  }

  const workspaceId = match[1]!;
  const subtopic = match[2]!;

  if (subtopic === "fs.dirty") {
    const data = (payload ?? {}) as { reason?: string };
    return {
      workspaceId,
      hint: {
        refreshGit: true,
        refreshBranches: data.reason === "git_metadata",
        refreshWorktrees: data.reason === "git_metadata",
        markTreeStale: shouldMarkTreeStaleForFsReason(data.reason),
        refreshEditorBuffers: data.reason === "fs_change" || data.reason === "file_content",
      },
    };
  }

  const data = (payload ?? {}) as {
    treeChanged?: boolean;
    branchChanged?: boolean;
    worktreeChanged?: boolean;
  };

  return {
    workspaceId,
    hint: {
      refreshGit: true,
      refreshBranches: Boolean(data.branchChanged),
      refreshWorktrees: Boolean(data.worktreeChanged),
      markTreeStale: Boolean(data.treeChanged),
      refreshEditorBuffers: Boolean(data.treeChanged),
    },
  };
}

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [, setWsClient] = useAtom(wsClientAtom);
  const setTheme = useSetAtom(themeAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const setConnectionError = useSetAtom(connectionErrorAtom);
  const setServerInfo = useSetAtom(serverInfoAtom);
  const setAuthEnabled = useSetAtom(authEnabledAtom);
  const setReconnectCount = useSetAtom(reconnectAttemptCountAtom);
  const setLastReconnect = useSetAtom(lastReconnectAttemptAtom);
  const setIsWriter = useSetAtom(isWriterAtom);

  // Server state atoms
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setSessions = useSetAtom(sessionsAtom);
  // Supervisor state atoms
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setSupervisorCycles = useSetAtom(supervisorCyclesAtom);
  const setTerminalPreferences = useSetAtom(terminalPreferencesAtom);

  // Get Jotai store for writing to atomFamily atoms
  const store = useStore();
  const dispatch = useAtomValue(dispatchCommandAtom);

  useSessionNotifications();

  // Use refs to avoid stale closures in event handlers
  const wsClientRef = useRef<WsClient | null>(null);
  const dispatchRef = useRef<DispatchCommand>(dispatch);
  const refreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const refreshHintsRef = useRef<Map<string, WorkspaceRefreshHint>>(new Map());
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const connectionStatusRef = useRef<ConnectionStatus>(connectionStatus);
  const lastForegroundRecoveryAtRef = useRef<number | null>(null);
  const workspaceActivityRef = useRef<WorkspaceActivityState>({
    mode: "inactive",
    workspaceId: null,
  });

  // Keep dispatchRef in sync
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;
    let localTerminalPreferencesUpdated = false;
    const unsubscribeTerminalPreferences = store.sub(terminalPreferencesAtom, () => {
      localTerminalPreferencesUpdated = true;
    });

    const hydrateTerminalPreferences = async () => {
      const result = await dispatch<Record<string, unknown>>("settings.get", {});
      if (cancelled || !result.ok || !result.data) {
        return;
      }

      if (localTerminalPreferencesUpdated) {
        return;
      }

      setTerminalPreferences({
        copyOnSelect: resolveTerminalCopyOnSelectSetting(result.data),
      });
    };

    void hydrateTerminalPreferences();

    return () => {
      cancelled = true;
      unsubscribeTerminalPreferences();
    };
  }, [connectionStatus, dispatch, setTerminalPreferences, store]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  // Initialize theme from localStorage
  useEffect(() => {
    applyResolvedTheme(readStoredThemePreference());
  }, []);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const hydrateTheme = async () => {
      const result = await dispatch<Record<string, unknown>>("settings.get", {});
      if (cancelled || !result.ok || !result.data) {
        return;
      }

      const settings = result.data;
      const resolvedThemeId = applyResolvedTheme(
        settings["appearance.themeId"] ??
          settings["appearance.theme"] ??
          readStoredThemePreference()
      );

      setTheme(resolvedThemeId);
      localStorage.setItem(THEME_ID_STORAGE_KEY, JSON.stringify(resolvedThemeId));
    };

    void hydrateTheme();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, setTheme]);

  useEffect(() => {
    const loadAuthStatus = async () => {
      try {
        const response = await fetch("/auth/status");
        const data = await response.json();
        setAuthEnabled(Boolean(data.authEnabled));
        store.set(authenticatedAtom, Boolean(data.authenticated) || data.authEnabled === false);
      } catch {
        store.set(authenticatedAtom, false);
      }
    };

    void loadAuthStatus();
  }, [setAuthEnabled, store]);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    if (authEnabled === true && !authenticated) {
      if (pendingDisconnectTimer) {
        clearTimeout(pendingDisconnectTimer);
        pendingDisconnectTimer = null;
      }

      if (globalWsClient) {
        globalWsClient.disconnect("auth_required");
        globalWsClient = null;
      }

      wsClientRef.current = null;
      setWsClient(null);
      setConnectionStatus("connecting");
      setConnectionError(null);
      setServerInfo(null);
      setReconnectCount(0);
      setLastReconnect(null);
      setIsWriter(false);
      return;
    }

    // Subscribe to connection status changes
    const handleStatusChange = (status: ConnectionStatus) => {
      setConnectionStatus(status);

      // Track reconnect attempts
      if (status === "reconnecting") {
        setReconnectCount((count) => count + 1);
        setLastReconnect(Date.now());
      }

      // Reset writer status on disconnect
      if (status === "disconnected" || status === "rejected") {
        setIsWriter(false);
      }

      if (status === "connected") {
        syncWorkspaceActivity(true);
      }
    };

    const refreshGitState = (workspaceId: string) => {
      dispatchRef
        .current<GitStatus>("git.status", { workspaceId })
        .then((result) => {
          if (result.ok && result.data) {
            store.set(gitStateAtomFamily(workspaceId), result.data);
          }
        })
        .catch((error) => {
          console.error("[Git Status] git.status command threw error:", error);
        });
    };

    const sendWorkspaceDeactivate = () => {
      const currentState = workspaceActivityRef.current;
      if (currentState.mode === "inactive") {
        return;
      }
      const client = wsClientRef.current;
      if (!client) {
        return;
      }
      workspaceActivityRef.current = {
        mode: "inactive",
        workspaceId: null,
      };
      void client.sendCommand("workspace.deactivate", {}).catch(() => {});
    };

    const sendWorkspaceActivate = (workspaceId: string) => {
      const currentState = workspaceActivityRef.current;
      if (currentState.mode === "active" && currentState.workspaceId === workspaceId) {
        return;
      }
      const client = wsClientRef.current;
      if (!client) {
        return;
      }
      workspaceActivityRef.current = {
        mode: "active",
        workspaceId,
      };
      void client.sendCommand("workspace.activate", { workspaceId }).catch(() => {});
    };

    const syncWorkspaceActivity = (force = false) => {
      if (document.visibilityState === "hidden") {
        sendWorkspaceDeactivate();
        return;
      }

      const workspaceId = activeWorkspaceIdRef.current;
      if (!workspaceId) {
        sendWorkspaceDeactivate();
        return;
      }

      if (force) {
        workspaceActivityRef.current = {
          mode: "inactive",
          workspaceId: null,
        };
      }

      sendWorkspaceActivate(workspaceId);
    };

    const triggerForegroundRecovery = () => {
      syncWorkspaceActivity();
      if (document.visibilityState !== "visible") {
        lastForegroundRecoveryAtRef.current = null;
        return;
      }

      const now = Date.now();
      const lastForegroundRecoveryAt = lastForegroundRecoveryAtRef.current;
      if (
        lastForegroundRecoveryAt !== null &&
        now - lastForegroundRecoveryAt < FOREGROUND_RECOVERY_COOLDOWN_MS
      ) {
        return;
      }

      lastForegroundRecoveryAtRef.current = now;
      wsClientRef.current?.recoverConnection("visibility_resume");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastForegroundRecoveryAtRef.current = null;
        syncWorkspaceActivity();
        return;
      }

      triggerForegroundRecovery();
    };

    const handleWindowFocus = () => {
      triggerForegroundRecovery();
    };

    const handlePageShow = () => {
      triggerForegroundRecovery();
    };

    const handleOnline = () => {
      wsClientRef.current?.recoverConnection("network_online");
    };

    const refreshBranchState = (workspaceId: string) => {
      dispatchRef
        .current<{ current: string; branches: GitBranch[] }>("git.branches", { workspaceId })
        .then((result) => {
          if (result.ok && result.data) {
            store.set(gitBranchListAtomFamily(workspaceId), {
              current: result.data.current,
              branches: result.data.branches,
              loading: false,
            });
            return;
          }

          store.set(gitBranchListAtomFamily(workspaceId), (prev) => ({
            ...prev,
            loading: false,
            error: result.error?.message ?? prev.error,
          }));
        })
        .catch((error) => {
          console.error("[Git Branches] git.branches command threw error:", error);
        });
    };

    const refreshWorktreeList = (workspaceId: string) => {
      store.set(worktreeListAtomFamily(workspaceId), (prev) => ({
        ...prev,
        loading: true,
        error: undefined,
      }));
      dispatchRef
        .current<{ worktrees: WorktreeInfo[] }>("worktree.list", { workspaceId })
        .then((result) => {
          if (result.ok && result.data && Array.isArray(result.data.worktrees)) {
            store.set(worktreeListAtomFamily(workspaceId), {
              items: result.data.worktrees,
              loading: false,
              lastLoadedAt: Date.now(),
            });
            return;
          }

          store.set(worktreeListAtomFamily(workspaceId), (prev) => ({
            ...prev,
            loading: false,
            error: result.error?.message ?? prev.error,
          }));
        })
        .catch((error) => {
          console.error("[Worktree List] worktree.list command threw error:", error);
          store.set(worktreeListAtomFamily(workspaceId), (prev) => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    };

    const queueWorkspaceRefresh = (workspaceId: string, hint: Partial<WorkspaceRefreshHint>) => {
      const nextHint = mergeRefreshHints(
        refreshHintsRef.current.get(workspaceId) ?? DEFAULT_REFRESH_HINT,
        hint
      );
      refreshHintsRef.current.set(workspaceId, nextHint);

      const existingTimer = refreshTimersRef.current.get(workspaceId);
      if (existingTimer) {
        return;
      }

      const timer = setTimeout(() => {
        refreshTimersRef.current.delete(workspaceId);
        const queuedHint = refreshHintsRef.current.get(workspaceId) ?? DEFAULT_REFRESH_HINT;
        refreshHintsRef.current.delete(workspaceId);

        if (queuedHint.markTreeStale) {
          store.set(fileTreeStaleAtomFamily(workspaceId), true);
        }
        if (queuedHint.refreshEditorBuffers) {
          store.set(editorRefreshTokenAtomFamily(workspaceId), (prev) => prev + 1);
        }
        if (queuedHint.refreshGit) {
          refreshGitState(workspaceId);
        }
        if (queuedHint.refreshBranches) {
          refreshBranchState(workspaceId);
        }
        if (queuedHint.refreshWorktrees) {
          refreshWorktreeList(workspaceId);
        }
      }, 60);

      refreshTimersRef.current.set(workspaceId, timer);
    };

    // Event handler: route WS events to atoms
    const handleEvent: EventListener = (topic: string, payload: unknown, _seq: number) => {
      const refreshInfo = parseWorkspaceRefreshHint(topic, payload);
      if (refreshInfo) {
        queueWorkspaceRefresh(refreshInfo.workspaceId, refreshInfo.hint);
      }

      try {
        routeEventToAtom(topic, payload, store);
      } catch (err) {
        console.error(`Error handling event for topic ${topic}:`, err);
      }
    };

    // Subscribe to all topics we care about
    const topics = [
      "connection.*", // Connection-level events
      "workspace.*", // All workspace events (glob pattern)
    ];

    // Reuse existing WebSocket client if available (StrictMode safety)
    // Cancel any pending disconnect from StrictMode cleanup
    if (pendingDisconnectTimer) {
      clearTimeout(pendingDisconnectTimer);
      pendingDisconnectTimer = null;
    }

    if (globalWsClient) {
      wsClientRef.current = globalWsClient;
      setWsClient(globalWsClient);
      const status = globalWsClient.getStatus();
      setConnectionStatus(status);

      // Re-establish subscriptions for this mount
      const unsubscribeStatus = globalWsClient.onStatus(handleStatusChange);
      const unsubscribeEvents = globalWsClient.subscribe(topics, handleEvent);

      if (status === "disconnected" || status === "reconnecting") {
        globalWsClient.recoverConnection("manual_retry");
      }

      syncWorkspaceActivity();

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleWindowFocus);
      window.addEventListener("pageshow", handlePageShow);
      window.addEventListener("online", handleOnline);

      return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("focus", handleWindowFocus);
        window.removeEventListener("pageshow", handlePageShow);
        window.removeEventListener("online", handleOnline);
        unsubscribeStatus();
        unsubscribeEvents();
        refreshTimersRef.current.forEach((timer) => clearTimeout(timer));
        refreshTimersRef.current.clear();
        refreshHintsRef.current.clear();
        wsClientRef.current = null;
        // Deferred disconnect: wait 50ms to see if StrictMode remounts
        if (globalWsClient) {
          pendingDisconnectTimer = setTimeout(() => {
            if (globalWsClient) {
              globalWsClient.disconnect("app_unmount");
              globalWsClient = null;
            }
            pendingDisconnectTimer = null;
          }, 50);
        }
      };
    }

    // Create new WebSocket client singleton
    const client = new WsClient(resolveWsUrl());
    globalWsClient = client;
    wsClientRef.current = client;
    setWsClient(client);

    // Subscribe to connection status changes
    const unsubscribeStatus = client.onStatus(handleStatusChange);

    // Subscribe to events
    const unsubscribeEvents = client.subscribe(topics, handleEvent);

    // Connect to server
    client.connect().catch((err) => {
      console.error("Failed to connect WebSocket:", err);
      setConnectionError(err.message || "Connection failed");
    });

    syncWorkspaceActivity();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("online", handleOnline);

    // Cleanup on unmount
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      unsubscribeStatus();
      unsubscribeEvents();
      refreshTimersRef.current.forEach((timer) => clearTimeout(timer));
      refreshTimersRef.current.clear();
      refreshHintsRef.current.clear();
      wsClientRef.current = null;
      // Deferred disconnect: wait 50ms to see if StrictMode remounts
      pendingDisconnectTimer = setTimeout(() => {
        if (globalWsClient) {
          globalWsClient.disconnect("app_unmount");
          globalWsClient = null;
        }
        pendingDisconnectTimer = null;
      }, 50);
    };
  }, [
    setWsClient,
    setConnectionStatus,
    setConnectionError,
    setServerInfo,
    setAuthEnabled,
    setReconnectCount,
    setLastReconnect,
    setIsWriter,
    setWorkspaces,
    setSessions,
    setSupervisors,
    setSupervisorCycles,
    store,
    authEnabled,
    authenticated,
  ]);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    if (authEnabled === true && !authenticated) {
      workspaceActivityRef.current = {
        mode: "inactive",
        workspaceId: null,
      };
      return;
    }

    if (connectionStatus !== "connected") {
      return;
    }

    if (document.visibilityState === "hidden") {
      if (workspaceActivityRef.current.mode !== "inactive") {
        const client = wsClientRef.current;
        if (!client) {
          return;
        }
        workspaceActivityRef.current = {
          mode: "inactive",
          workspaceId: null,
        };
        void client.sendCommand("workspace.deactivate", {}).catch(() => {});
      }
      return;
    }

    if (!activeWorkspaceId) {
      if (workspaceActivityRef.current.mode !== "inactive") {
        const client = wsClientRef.current;
        if (!client) {
          return;
        }
        workspaceActivityRef.current = {
          mode: "inactive",
          workspaceId: null,
        };
        void client.sendCommand("workspace.deactivate", {}).catch(() => {});
      }
      return;
    }

    if (
      workspaceActivityRef.current.mode === "active" &&
      workspaceActivityRef.current.workspaceId === activeWorkspaceId
    ) {
      return;
    }

    const client = wsClientRef.current;
    if (!client) {
      return;
    }

    workspaceActivityRef.current = {
      mode: "active",
      workspaceId: activeWorkspaceId,
    };
    void client
      .sendCommand("workspace.activate", { workspaceId: activeWorkspaceId })
      .catch(() => {});
  }, [activeWorkspaceId, authEnabled, authenticated, connectionStatus]);

  return <>{children}</>;
}

function storeServerMetadata(
  payload: unknown,
  store: Store
): payload is {
  version: string;
  serverInstanceId: string;
  authEnabled?: boolean;
  isWriter?: boolean;
} {
  const data = payload as {
    version?: unknown;
    serverInstanceId?: unknown;
    authEnabled?: unknown;
    isWriter?: unknown;
  };

  if (typeof data.version !== "string" || typeof data.serverInstanceId !== "string") {
    return false;
  }

  store.set(serverInfoAtom, {
    version: data.version,
    serverInstanceId: data.serverInstanceId,
    authEnabled: typeof data.authEnabled === "boolean" ? data.authEnabled : undefined,
  });
  if (typeof data.isWriter === "boolean") {
    store.set(isWriterAtom, data.isWriter);
  }

  return true;
}

/**
 * Route incoming WebSocket events to appropriate Jotai atoms
 */
export function routeEventToAtom(topic: string, payload: unknown, store: Store): void {
  // Parse topic to determine event type
  // Topic format: workspace.{id}.session.{sessionId}.state
  // or: connection.ready

  if (topic === "connection.ready") {
    storeServerMetadata(payload, store);
    store.set(connectionErrorAtom, null);
    return;
  }

  if (topic === "connection.status") {
    // Connection-level status event
    const data = payload as {
      status: string;
      message?: string;
      authEnabled?: boolean;
      version?: string;
      serverInstanceId?: string;
      isWriter?: boolean;
    };
    if (data.status === "connected") {
      storeServerMetadata(payload, store);
    }
    if (data.status === "connected" && data.authEnabled === false) {
      store.set(authenticatedAtom, true);
    }
    if (data.status === "error" && data.message) {
      store.set(connectionErrorAtom, data.message);
    }
    return;
  }

  // Workspace-level events: workspace.{id}.{subtopic}
  const workspaceMatch = topic.match(/^workspace\.([^.]+)\.(.+)$/);
  if (workspaceMatch) {
    const workspaceId = workspaceMatch[1]!;
    const subtopic = workspaceMatch[2]!;

    // workspace.{id}.meta - workspace metadata update
    if (subtopic === "meta") {
      const patch = payload as Partial<Workspace>;
      const existing = store.get(workspacesAtom)[workspaceId];
      const shouldAcceptWorkspace = Boolean(existing || patch.path);

      if (!shouldAcceptWorkspace) {
        return;
      }

      store.set(workspacesAtom, (prev: Record<string, Workspace>) => ({
        ...prev,
        [workspaceId]: {
          ...prev[workspaceId],
          ...patch,
          id: workspaceId,
        } as Workspace,
      }));
      store.set(workspaceOrderAtom, (prev: string[]) => {
        if (prev.includes(workspaceId)) {
          return prev;
        }
        return [...prev, workspaceId];
      });
      store.set(workspacesLoadStateAtom, "ready");
      store.set(workspacesLoadErrorAtom, null);
      return;
    }

    // workspace.{id}.fs.dirty - filesystem dirty state
    if (subtopic === "fs.dirty") {
      const data = (payload ?? {}) as { reason?: string };
      if (shouldMarkTreeStaleForFsReason(data.reason)) {
        const atom = fileTreeStaleAtomFamily(workspaceId);
        store.set(atom, true);
      }
      return;
    }

    // workspace.{id}.git.state - git state changed notification
    if (subtopic === "git.state") {
      return;
    }

    // workspace.{id}.session.{sessionId}.{type}
    const sessionMatch = subtopic.match(/^session\.([^.]+)\.(.+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1]!;
      const sessionSubtopic = sessionMatch[2]!;

      if (sessionSubtopic === "lifecycle") {
        const data = payload as { event?: string };
        if (data.event === "removed") {
          const removedSession = store.get(sessionsAtom)[sessionId];
          if (removedSession?.terminalId) {
            store.set(terminalMetaAtomFamily(removedSession.terminalId), null);
          }
          store.set(sessionsAtom, (prev: Record<string, Session>) => {
            if (!(sessionId in prev)) {
              return prev;
            }
            const next = { ...prev };
            delete next[sessionId];
            return next;
          });
        }
        return;
      }

      // workspace.{id}.session.{sessionId}.state
      if (sessionSubtopic === "state") {
        const session = payload as Session;
        store.set(sessionsAtom, (prev: Record<string, Session>) => ({
          ...prev,
          [session.id]: session,
        }));
        return;
      }

      // workspace.{id}.session.{sessionId}.progress
      if (sessionSubtopic === "progress") {
        // Progress updates can be handled separately if needed
        // For now, we'll just log them
        console.log(`Session ${sessionId} progress:`, payload);
        return;
      }

      // workspace.{id}.session.{sessionId}.supervisor.state
      if (sessionSubtopic === "supervisor.state") {
        const data = payload as { supervisor?: Supervisor; supervisorId?: string; event: string };
        if (data.event === "deleted" && data.supervisorId) {
          store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => {
            const next = new Map(prev);
            // Find and remove by supervisor ID
            for (const [sessId, sup] of next.entries()) {
              if (sup.id === data.supervisorId) {
                next.delete(sessId);
                break;
              }
            }
            return next;
          });
          store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
            const next = new Map(prev);
            next.delete(data.supervisorId!);
            return next;
          });
        } else if (data.supervisor) {
          const supervisor = data.supervisor;
          store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => {
            const next = new Map(prev);
            next.set(supervisor.sessionId, supervisor);
            return next;
          });
          if (Array.isArray(supervisor.cycles)) {
            store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
              const next = new Map(prev);
              next.set(supervisor.id, supervisor.cycles);
              return next;
            });
          }
        }
        return;
      }

      // workspace.{id}.session.{sessionId}.supervisor.cycle
      if (sessionSubtopic === "supervisor.cycle") {
        const data = payload as { cycle: SupervisorCycle; event: string };
        const supervisorId = data.cycle.supervisorId;
        store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
          const next = new Map(prev);
          const cycles = next.get(supervisorId) ?? [];
          const deduped = cycles.filter((cycle) => cycle.id !== data.cycle.id);
          next.set(supervisorId, [data.cycle, ...deduped].slice(0, 20));
          return next;
        });
        return;
      }
    }

    // workspace.{id}.terminal.{terminalId}.{type}
    const terminalMatch = subtopic.match(/^terminal\.([^.]+)\.(.+)$/);
    if (terminalMatch) {
      const terminalId = terminalMatch[1]!;
      const terminalSubtopic = terminalMatch[2]!;

      // workspace.{id}.terminal.{terminalId}.created
      if (terminalSubtopic === "created") {
        const data = payload as { id: string; kind: string; title?: string; cwd?: string };
        const atom = terminalMetaAtomFamily(terminalId);
        store.set(atom, {
          id: data.id,
          workspaceId,
          kind: data.kind as "agent" | "shell",
          alive: true,
          title: data.title,
        });
        return;
      }

      // workspace.{id}.terminal.{terminalId}.output
      // Terminal panels consume output directly via xterm.js — no router-level
      // handling needed.
      if (terminalSubtopic === "output") {
        return;
      }

      // workspace.{id}.terminal.{terminalId}.exit
      if (terminalSubtopic === "exit") {
        const data = payload as { code: number };
        const atom = terminalMetaAtomFamily(terminalId);
        const current = store.get(atom);
        if (current) {
          store.set(atom, {
            ...current,
            exitCode: data.code,
            alive: false,
          });
        }
        return;
      }
    }
  }

  // Unknown topic - log for debugging
  console.log(`Unhandled event topic: ${topic}`, payload);
}
