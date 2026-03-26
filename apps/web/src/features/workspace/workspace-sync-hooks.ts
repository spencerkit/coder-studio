import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  subscribeAgentEvents,
  subscribeAgentLifecycleEvents,
  subscribeTerminalEvents,
  subscribeWorkspaceArtifactsDirty,
  subscribeWorkspaceController,
  subscribeWorkspaceRuntimeState,
} from "../../command";
import { createId, type ExecTarget, type SessionStatus, type Tab, type WorkbenchState, type WorktreeInfo } from "../../state/workbench";
import { getGitChanges } from "../../services/http/git.service";
import { getGitStatus, getWorkspaceTree, getWorktreeList } from "../../services/http/workspace.service";
import {
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeStateEvent,
} from "../../shared/utils/workspace";
import {
  AGENT_START_SYSTEM_MESSAGE,
  AGENT_STREAM_BUFFER_LIMIT,
  TERMINAL_STREAM_BUFFER_LIMIT,
} from "../../shared/app/constants";
import { stripAnsi } from "../../shared/utils/ansi";
import { pathsIntersect } from "../../shared/utils/path";
import { nowLabel, resolveVisibleStatus } from "../../shared/utils/session";
import type {
  AgentLifecycleEvent,
  ArtifactsDirtyEvent,
  GitChangeEntry,
  GitStatus,
  SessionPatch,
  WorkspaceTree,
} from "../../types/app";
import { subscribeWsConnectionState } from "../../ws/client";
import {
  clearAgentRuntimeTracking,
  noteAgentStartupEvent,
  noteAgentStartupLifecycle,
  type AgentRuntimeRefs,
} from "../agents";
import type { Translator } from "../../i18n";

type UpdateState = (updater: (current: WorkbenchState) => WorkbenchState) => void;
type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type UseWorkspaceTransportSyncArgs = {
  agentRuntimeRefs: AgentRuntimeRefs;
  bootstrapReady: boolean;
  clientId: string;
  deviceId: string;
  refreshTabFromBackend: (tabId: string) => Promise<void>;
  markSessionIdle: (workspaceId: string, sessionId: string) => Promise<void>;
  settleSessionAfterExit: (workspaceId: string, sessionId: string) => Promise<void>;
  syncSessionPatch: (tabId: string, sessionId: string, patch: SessionPatch) => Promise<void>;
  stateRef: MutableRefObject<WorkbenchState>;
  t: Translator;
  updateState: UpdateState;
};

type UseWorkspaceArtifactsSyncArgs = {
  activeTabId: string;
  activeProjectPath?: string;
  bootstrapReady: boolean;
  codeSidebarView: string;
  stateRef: MutableRefObject<WorkbenchState>;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
};

type ArtifactPollIntervalGlobal = typeof globalThis & {
  __CODER_STUDIO_ARTIFACT_FALLBACK_POLL_INTERVAL_MS__?: number;
};

// WebSocket invalidation is the primary sync path; keep polling as a low-frequency
// fallback for changes that happen outside app-originated RPCs.
const DEFAULT_ARTIFACT_FALLBACK_POLL_INTERVAL_MS = 30000;

const resolveArtifactFallbackPollIntervalMs = () => {
  const override = Number(
    (globalThis as ArtifactPollIntervalGlobal).__CODER_STUDIO_ARTIFACT_FALLBACK_POLL_INTERVAL_MS__,
  );
  if (Number.isFinite(override) && override > 0) {
    return override;
  }
  return DEFAULT_ARTIFACT_FALLBACK_POLL_INTERVAL_MS;
};

const useLatestRef = <T,>(value: T) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const sameExecTarget = (left: ExecTarget | undefined, right: ExecTarget | undefined) => {
  if (!left || !right) return false;
  if (left.type !== right.type) return false;
  if (left.type !== "wsl" || right.type !== "wsl") return true;
  return (left.distro?.trim() ?? "") === (right.distro?.trim() ?? "");
};

const matchesWorkspaceArtifactsEvent = (tab: Tab, event: ArtifactsDirtyEvent) => {
  const workspacePath = tab.project?.path;
  if (!workspacePath) return false;
  if (!sameExecTarget(tab.project?.target, event.target)) return false;
  return pathsIntersect(workspacePath, event.path);
};

const readClaudeSessionId = (data: string) => {
  try {
    const payload = JSON.parse(data) as { session_id?: string };
    return typeof payload.session_id === "string" && payload.session_id.trim()
      ? payload.session_id.trim()
      : null;
  } catch {
    return null;
  }
};

export const useWorkspaceTransportSync = ({
  agentRuntimeRefs,
  bootstrapReady,
  clientId,
  deviceId,
  refreshTabFromBackend,
  markSessionIdle,
  settleSessionAfterExit,
  syncSessionPatch,
  stateRef,
  t,
  updateState,
}: UseWorkspaceTransportSyncArgs) => {
  const updateStateRef = useLatestRef(updateState);
  const refreshTabFromBackendRef = useLatestRef(refreshTabFromBackend);
  const markSessionIdleRef = useLatestRef(markSessionIdle);
  const settleSessionAfterExitRef = useLatestRef(settleSessionAfterExit);
  const syncSessionPatchRef = useLatestRef(syncSessionPatch);
  const transportResyncPromiseRef = useRef<Promise<void> | null>(null);

  const resyncWorkspaceSnapshots = useCallback(async () => {
    if (transportResyncPromiseRef.current) {
      await transportResyncPromiseRef.current;
      return;
    }

    const workspaceIds = stateRef.current.tabs.map((tab) => tab.id).filter(Boolean);
    if (workspaceIds.length === 0) return;

    const task = (async () => {
      await Promise.all(workspaceIds.map(async (workspaceId) => {
        await refreshTabFromBackendRef.current(workspaceId);
      }));
    })().finally(() => {
      transportResyncPromiseRef.current = null;
    });

    transportResyncPromiseRef.current = task;
    await task;
  }, [refreshTabFromBackendRef, stateRef]);

  useEffect(() => {
    const unsubscribe = subscribeAgentEvents(({ workspace_id, session_id, kind, data }) => {
      noteAgentStartupEvent(agentRuntimeRefs, workspace_id, session_id, kind, data);
      const cleaned = stripAnsi(data);
      const isStream = kind === "stdout" || kind === "stderr";
      const isSystem = kind === "system";
      const isExit = kind === "exit";

      updateStateRef.current((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== workspace_id) return tab;
          return {
            ...tab,
            sessions: tab.sessions.map((session) => {
              if (session.id !== session_id) return session;
              const nextStatus = isStream
                ? session.status
                : isExit
                  ? "idle"
                  : session.status;
              const streamChunk = isExit
                ? "\n[agent exited]\n"
                : isSystem
                  ? (cleaned && cleaned !== AGENT_START_SYSTEM_MESSAGE ? `\n[${cleaned}]\n` : "")
                  : data;
              const nextStream = `${session.stream}${streamChunk}`.slice(-AGENT_STREAM_BUFFER_LIMIT);
              const message = isExit
                ? { id: createId("msg"), role: "system" as const, content: t("agentExited"), time: nowLabel() }
                : isSystem
                  ? { id: createId("msg"), role: "system" as const, content: cleaned, time: nowLabel() }
                  : null;
              const unread = tab.activeSessionId === session.id ? 0 : session.unread + (isSystem || isExit || isStream ? 1 : 0);
              return {
                ...session,
                status: nextStatus,
                unread,
                stream: nextStream,
                messages: message ? [...session.messages, message] : session.messages,
              };
            }),
          };
        }),
      }));

      if (kind === "exit") {
        clearAgentRuntimeTracking(agentRuntimeRefs, workspace_id, session_id);
        void settleSessionAfterExitRef.current(workspace_id, session_id);
      }
    });
    return unsubscribe;
  }, [agentRuntimeRefs, settleSessionAfterExitRef, t, updateStateRef]);

  useEffect(() => {
    const unsubscribe = subscribeAgentLifecycleEvents(({ workspace_id, session_id, kind, data }: AgentLifecycleEvent) => {
      noteAgentStartupLifecycle(agentRuntimeRefs, workspace_id, session_id, kind);
      let nextStatus: SessionStatus | null = null;
      if (kind === "turn_waiting" || kind === "approval_required") {
        nextStatus = "waiting";
      } else if (kind === "tool_started" || kind === "tool_finished") {
        nextStatus = "running";
      } else if (kind === "session_ended") {
        nextStatus = "idle";
      }

      if (kind === "session_ended") {
        clearAgentRuntimeTracking(agentRuntimeRefs, workspace_id, session_id);
      }

      if (nextStatus) {
        updateStateRef.current((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== workspace_id) return tab;
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === session_id
                  ? {
                      ...session,
                      status: resolveVisibleStatus(tab, session, nextStatus),
                    }
                  : session,
              ),
            };
          }),
        }));
      }

      const claudeSessionId = readClaudeSessionId(data);
      if (claudeSessionId) {
        let changed = false;
        updateStateRef.current((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== workspace_id) return tab;
            return {
              ...tab,
              sessions: tab.sessions.map((session) => {
                if (session.id !== session_id || session.claudeSessionId === claudeSessionId) {
                  return session;
                }
                changed = true;
                return {
                  ...session,
                  claudeSessionId,
                };
              }),
            };
          }),
        }));
        if (changed) {
          void syncSessionPatchRef.current(workspace_id, session_id, { claude_session_id: claudeSessionId });
        }
      }

      if (kind === "turn_completed") {
        void markSessionIdleRef.current(workspace_id, session_id);
      }
    });
    return unsubscribe;
  }, [agentRuntimeRefs, markSessionIdleRef, syncSessionPatchRef, updateStateRef]);

  useEffect(() => {
    const unsubscribe = subscribeTerminalEvents(({ workspace_id, terminal_id, data }) => {
      if (!data) return;
      const termId = `term-${terminal_id}`;
      updateStateRef.current((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== workspace_id) return tab;
          return {
            ...tab,
            terminals: tab.terminals.map((term) => {
              if (term.id !== termId) return term;
              const nextOutput = `${term.output}${data}`.slice(-TERMINAL_STREAM_BUFFER_LIMIT);
              return { ...term, output: nextOutput };
            }),
          };
        }),
      }));
    });
    return unsubscribe;
  }, [updateStateRef]);

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceController((payload) => {
      updateStateRef.current((current) =>
        applyWorkspaceControllerEvent(current, payload, deviceId, clientId),
      );
    });
    return unsubscribe;
  }, [clientId, deviceId, updateStateRef]);

  useEffect(() => {
    const unsubscribe = subscribeWorkspaceRuntimeState((payload) => {
      updateStateRef.current((current) => applyWorkspaceRuntimeStateEvent(current, payload));
    });
    return unsubscribe;
  }, [updateStateRef]);

  useEffect(() => {
    const unsubscribe = subscribeWsConnectionState(({ kind }) => {
      if (kind !== "reconnected" || !bootstrapReady) return;
      void resyncWorkspaceSnapshots();
    });
    return unsubscribe;
  }, [bootstrapReady, resyncWorkspaceSnapshots]);
};

export const useWorkspaceArtifactsSync = ({
  activeTabId,
  activeProjectPath,
  bootstrapReady,
  codeSidebarView,
  stateRef,
  updateTab,
  withServiceFallback,
}: UseWorkspaceArtifactsSyncArgs) => {
  const pendingRefreshesRef = useRef(new Map<string, Promise<WorkspaceTree | null>>());
  const updateTabRef = useLatestRef(updateTab);
  const withServiceFallbackRef = useLatestRef(withServiceFallback);

  const runWorkspaceArtifactsRefresh = useCallback(async (tabId: string): Promise<WorkspaceTree | null> => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const path = tab?.project?.path;
    const target = tab?.project?.target;
    if (!tab || !path || !target) return null;

    const [git, gitChanges, worktrees, tree] = await Promise.all([
      withServiceFallbackRef.current<GitStatus>(() => getGitStatus(path, target), {
        branch: tab.git.branch || "main",
        changes: tab.git.changes ?? 0,
        last_commit: tab.git.lastCommit || "—",
      }),
      withServiceFallbackRef.current<GitChangeEntry[]>(() => getGitChanges(path, target), tab.gitChanges ?? []),
      withServiceFallbackRef.current<WorktreeInfo[]>(() => getWorktreeList(path, target), tab.worktrees),
      withServiceFallbackRef.current<WorkspaceTree>(() => getWorkspaceTree(path, target, 4), {
        root: { name: ".", path, kind: "dir", children: [] },
        changes: [],
      }),
    ]);

    updateTabRef.current(tabId, (currentTab) => ({
      ...currentTab,
      git: {
        branch: git.branch || currentTab.git.branch || "main",
        changes: git.changes ?? currentTab.git.changes ?? 0,
        lastCommit: git.last_commit || currentTab.git.lastCommit || "—",
      },
      gitChanges,
      worktrees,
      fileTree: tree.root.children ?? [],
      changesTree: tree.changes ?? [],
    }));
    return tree;
  }, [stateRef, updateTabRef, withServiceFallbackRef]);

  const refreshWorkspaceArtifacts = useCallback(async (tabId: string): Promise<WorkspaceTree | null> => {
    const pending = pendingRefreshesRef.current.get(tabId);
    if (pending) {
      return pending;
    }

    const task = runWorkspaceArtifactsRefresh(tabId).finally(() => {
      pendingRefreshesRef.current.delete(tabId);
    });
    pendingRefreshesRef.current.set(tabId, task);
    return task;
  }, [runWorkspaceArtifactsRefresh]);

  useEffect(() => {
    if (!bootstrapReady) return;
    const unsubscribe = subscribeWorkspaceArtifactsDirty((event) => {
      const matchingTabs = stateRef.current.tabs
        .filter((tab) => matchesWorkspaceArtifactsEvent(tab, event))
        .map((tab) => tab.id);
      matchingTabs.forEach((workspaceId) => {
        void refreshWorkspaceArtifacts(workspaceId);
      });
    });
    return unsubscribe;
  }, [bootstrapReady, refreshWorkspaceArtifacts, stateRef]);

  useEffect(() => {
    if (!activeProjectPath) return;
    void refreshWorkspaceArtifacts(activeTabId);
  }, [activeProjectPath, activeTabId, bootstrapReady, codeSidebarView, refreshWorkspaceArtifacts]);

  useEffect(() => {
    if (!activeProjectPath) return;
    const timer = window.setInterval(() => {
      void refreshWorkspaceArtifacts(activeTabId);
    }, resolveArtifactFallbackPollIntervalMs());
    return () => window.clearInterval(timer);
  }, [activeProjectPath, activeTabId, refreshWorkspaceArtifacts]);

  return {
    refreshWorkspaceArtifacts,
  };
};
