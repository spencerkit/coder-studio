import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  subscribeAgentLifecycleEvents,
  subscribeTerminalEvents,
  subscribeWorkspaceArtifactsDirty,
  subscribeWorkspaceController,
  subscribeWorkspaceRuntimeState,
} from "../../command";
import {
  subscribeTerminalChannelOutput,
  subscribeTerminalChannelReplay,
  sendTerminalChannelAttach,
} from "../../services/terminal-channel/client.ts";
import { type ExecTarget, type Tab, type WorkbenchState, type WorktreeInfo } from "../../state/workbench";
import { getGitChanges } from "../../services/http/git.service";
import { getGitStatus, getWorkspaceTree, getWorktreeList } from "../../services/http/workspace.service";
import {
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeStateEvent,
} from "../../shared/utils/workspace";
import {
  TERMINAL_STREAM_BUFFER_LIMIT,
  WS_STREAM_FLUSH_INTERVAL_MS,
} from "../../shared/app/constants";
import { pathsIntersect } from "../../shared/utils/path";
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
  noteAgentStartupLifecycle,
  type AgentRuntimeRefs,
} from "../agents";
import {
  FULL_ARTIFACT_REFRESH_SCOPE,
  hasArtifactRefreshWork,
  mergeArtifactRefreshScopes,
  resolveInitialArtifactRefreshScope,
  resolveArtifactRefreshScope,
  type ArtifactRefreshScope,
} from "./workspace-artifact-refresh";
import { createWorkspaceArtifactRefreshQueue } from "./workspace-artifact-refresh-queue";
import {
  applyPendingStreamIndex,
  createPendingStreamIndex,
  drainPendingStreamIndex,
  hasPendingStreamIndex,
  recordPendingTerminalStream,
} from "./workspace-stream-index";
import {
  isSessionBoundWorkspaceTerminalId,
  resolveSessionTerminalIdByRuntimeId,
} from "./session-runtime-bindings";
import {
  type WorkspaceRuntimeAttachRequestOptions,
  WS_RESYNC_ATTACH_SUCCESS_REUSE_MS,
} from "./runtime-attach";

type UpdateState = (updater: (current: WorkbenchState) => WorkbenchState) => void;
type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type UseWorkspaceTransportSyncArgs = {
  agentRuntimeRefs: AgentRuntimeRefs;
  bootstrapReady: boolean;
  clientId: string;
  deviceId: string;
  markSessionIdle: (workspaceId: string, sessionId: string) => Promise<void>;
  reattachWorkspaceRuntime: (
    workspaceId: string,
    options?: WorkspaceRuntimeAttachRequestOptions,
  ) => Promise<void>;
  syncSessionPatch: (tabId: string, sessionId: string, patch: SessionPatch) => Promise<void>;
  stateRef: MutableRefObject<WorkbenchState>;
  updateState: UpdateState;
};

type UseWorkspaceArtifactsSyncArgs = {
  activeTabId: string;
  activeProjectPath?: string;
  bootstrapReady: boolean;
  codeSidebarView: "files" | "git";
  showCodePanel: boolean;
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

const readResumeId = (data: string) => {
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
  markSessionIdle,
  reattachWorkspaceRuntime,
  syncSessionPatch,
  stateRef,
  updateState,
}: UseWorkspaceTransportSyncArgs) => {
  const updateStateRef = useLatestRef(updateState);
  const stateRefLatest = useLatestRef(stateRef.current);
  const markSessionIdleRef = useLatestRef(markSessionIdle);
  const reattachWorkspaceRuntimeRef = useLatestRef(reattachWorkspaceRuntime);
  const syncSessionPatchRef = useLatestRef(syncSessionPatch);
  const transportResyncPromiseRef = useRef<Promise<void> | null>(null);
  const pendingStreamIndexRef = useRef(createPendingStreamIndex());
  const streamFlushTimerRef = useRef<number | null>(null);

  const resyncWorkspaceSnapshots = useCallback(async (force = false) => {
    if (transportResyncPromiseRef.current) {
      await transportResyncPromiseRef.current;
      return;
    }

    const workspaceIds = stateRef.current.tabs.map((tab) => tab.id).filter(Boolean);
    if (workspaceIds.length === 0) return;

    const task = (async () => {
      await Promise.all(workspaceIds.map(async (workspaceId) => {
        await reattachWorkspaceRuntimeRef.current(workspaceId, {
          force,
          successReuseMs: force ? 0 : WS_RESYNC_ATTACH_SUCCESS_REUSE_MS,
        });
      }));
    })().finally(() => {
      transportResyncPromiseRef.current = null;
    });

    transportResyncPromiseRef.current = task;
    await task;
  }, [reattachWorkspaceRuntimeRef, stateRef]);

  const flushPendingStreams = useCallback(() => {
    streamFlushTimerRef.current = null;
    if (!hasPendingStreamIndex(pendingStreamIndexRef.current)) {
      return;
    }
    const pendingStreams = drainPendingStreamIndex(pendingStreamIndexRef.current);

    updateStateRef.current((current) => applyPendingStreamIndex(current, pendingStreams));
  }, [updateStateRef]);

  const schedulePendingStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      return;
    }
    streamFlushTimerRef.current = window.setTimeout(flushPendingStreams, WS_STREAM_FLUSH_INTERVAL_MS);
  }, [flushPendingStreams]);

  useEffect(() => () => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    flushPendingStreams();
  }, [flushPendingStreams]);

  useEffect(() => {
    const unsubscribe = subscribeAgentLifecycleEvents(({ workspace_id, session_id, kind, data }: AgentLifecycleEvent) => {
      noteAgentStartupLifecycle(agentRuntimeRefs, workspace_id, session_id, kind);

      const resumeId = readResumeId(data);
      if (resumeId) {
        let changed = false;
        updateStateRef.current((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== workspace_id) return tab;
            return {
              ...tab,
              sessions: tab.sessions.map((session) => {
                if (session.id !== session_id || session.resumeId === resumeId) {
                  return session;
                }
                changed = true;
                return {
                  ...session,
                  resumeId,
                };
              }),
            };
          }),
        }));
        if (changed) {
          void syncSessionPatchRef.current(workspace_id, session_id, { resume_id: resumeId });
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
      const mappedTerminalId = `term-${terminal_id}`;
      // skip session-bound terminals to avoid duplicate streams; they use terminal://channel_output
      const currentState = stateRefLatest.current;
      const matchedTab = currentState.tabs.find((tab) => tab.id === workspace_id);
      if (matchedTab && isSessionBoundWorkspaceTerminalId(matchedTab.sessions, mappedTerminalId)) {
        return;
      }
      const recorded = recordPendingTerminalStream(pendingStreamIndexRef.current, {
        workspaceId: workspace_id,
        terminalId: mappedTerminalId,
        chunk: data,
      });
      if (recorded) {
        schedulePendingStreamFlush();
      }
    });
    return unsubscribe;
  }, [agentRuntimeRefs, schedulePendingStreamFlush, stateRef]);

  useEffect(() => {
    const unsubscribe = subscribeTerminalChannelOutput(({ runtime_id, data }) => {
      const currentState = stateRefLatest.current;
      const matchedTab = currentState.tabs.find((tab) => (
        tab.sessions.some((session) => session.terminalRuntimeId === runtime_id)
      ));
      if (!matchedTab) {
        return;
      }
      const terminalId = resolveSessionTerminalIdByRuntimeId(
        matchedTab.sessions,
        runtime_id,
        matchedTab.terminals,
      );
      if (!terminalId) {
        return;
      }
      const recorded = recordPendingTerminalStream(pendingStreamIndexRef.current, {
        workspaceId: matchedTab.id,
        terminalId,
        chunk: data,
      });
      if (recorded) {
        schedulePendingStreamFlush();
      }
    });
    return unsubscribe;
  }, [schedulePendingStreamFlush, stateRefLatest]);

  useEffect(() => {
    const unsubscribe = subscribeTerminalChannelReplay(({ runtime_id, data }) => {
      const currentState = stateRefLatest.current;
      const matchedTab = currentState.tabs.find((tab) => (
        tab.sessions.some((session) => session.terminalRuntimeId === runtime_id)
      ));
      if (!matchedTab) {
        return;
      }
      const terminalId = resolveSessionTerminalIdByRuntimeId(
        matchedTab.sessions,
        runtime_id,
        matchedTab.terminals,
      );
      if (!terminalId) {
        return;
      }
      // Prepend ANSI clear screen + home before replay data so it replaces
      // existing terminal content rather than appending to it.
      const clearThenData = `\x1b[2J\x1b[H${data}`;
      const recorded = recordPendingTerminalStream(pendingStreamIndexRef.current, {
        workspaceId: matchedTab.id,
        terminalId,
        chunk: clearThenData,
      });
      if (recorded) {
        schedulePendingStreamFlush();
      }
    });
    return unsubscribe;
  }, [pendingStreamIndexRef, schedulePendingStreamFlush, stateRefLatest]);

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
      if ((kind !== "connected" && kind !== "reconnected") || !bootstrapReady) return;
      void resyncWorkspaceSnapshots(kind === "reconnected");
      // Attach terminal channel for each session so the server sends replay + live output.
      const currentState = stateRefLatest.current;
      for (const tab of currentState.tabs) {
        for (const session of tab.sessions) {
          if (session.terminalRuntimeId) {
            sendTerminalChannelAttach(tab.id, tab.controller.fencingToken, session.terminalRuntimeId);
          }
        }
      }
    });
    return unsubscribe;
  }, [bootstrapReady, resyncWorkspaceSnapshots]);
};

export const useWorkspaceArtifactsSync = ({
  activeTabId,
  activeProjectPath,
  bootstrapReady,
  codeSidebarView,
  showCodePanel,
  stateRef,
  updateTab,
  withServiceFallback,
}: UseWorkspaceArtifactsSyncArgs) => {
  const queuedRefreshScopesRef = useRef(new Map<string, ArtifactRefreshScope>());
  const refreshQueueRunnerRef = useRef<(tabId: string) => Promise<WorkspaceTree | null>>(
    async () => null,
  );
  const refreshQueueRef = useRef<ReturnType<typeof createWorkspaceArtifactRefreshQueue<WorkspaceTree | null>> | null>(null);
  const updateTabRef = useLatestRef(updateTab);
  const withServiceFallbackRef = useLatestRef(withServiceFallback);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  ));
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  ));

  if (!refreshQueueRef.current) {
    refreshQueueRef.current = createWorkspaceArtifactRefreshQueue<WorkspaceTree | null>(
      (tabId) => refreshQueueRunnerRef.current(tabId),
      (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      (handle) => globalThis.clearTimeout(handle as number),
      120,
    );
  }

  useEffect(() => () => {
    refreshQueueRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const syncEnvironmentState = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    };

    window.addEventListener("online", syncEnvironmentState);
    window.addEventListener("offline", syncEnvironmentState);
    document.addEventListener("visibilitychange", syncEnvironmentState);
    return () => {
      window.removeEventListener("online", syncEnvironmentState);
      window.removeEventListener("offline", syncEnvironmentState);
      document.removeEventListener("visibilitychange", syncEnvironmentState);
    };
  }, []);

  const runWorkspaceArtifactsRefresh = useCallback(async (
    tabId: string,
    scope: ArtifactRefreshScope,
  ): Promise<WorkspaceTree | null> => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const path = tab?.project?.path;
    const target = tab?.project?.target;
    if (!tab || !path || !target) return null;

    let git: GitStatus | null = null;
    let gitChanges: GitChangeEntry[] | null = null;
    let worktrees: WorktreeInfo[] | null = null;
    let tree: WorkspaceTree | null = null;

    const refreshes: Array<Promise<void>> = [];

    if (scope.git) {
      refreshes.push((async () => {
        const [nextGit, nextGitChanges] = await Promise.all([
          withServiceFallbackRef.current<GitStatus>(() => getGitStatus(path, target), {
            branch: tab.git.branch || "main",
            changes: tab.git.changes ?? 0,
            last_commit: tab.git.lastCommit || "—",
          }),
          withServiceFallbackRef.current<GitChangeEntry[]>(() => getGitChanges(path, target), tab.gitChanges ?? []),
        ]);
        git = nextGit;
        gitChanges = nextGitChanges;
      })());
    }

    if (scope.worktrees) {
      refreshes.push((async () => {
        worktrees = await withServiceFallbackRef.current<WorktreeInfo[]>(
          () => getWorktreeList(path, target),
          tab.worktrees,
        );
      })());
    }

    if (scope.tree) {
      refreshes.push((async () => {
        tree = await withServiceFallbackRef.current<WorkspaceTree>(() => getWorkspaceTree(path, target, 4), {
          root: { name: ".", path, kind: "dir", children: [] },
          changes: [],
        });
      })());
    }

    await Promise.all(refreshes);

    updateTabRef.current(tabId, (currentTab) => ({
      ...currentTab,
      git: git
        ? {
            branch: git.branch || currentTab.git.branch || "main",
            changes: git.changes ?? currentTab.git.changes ?? 0,
            lastCommit: git.last_commit || currentTab.git.lastCommit || "—",
          }
        : currentTab.git,
      gitChanges: gitChanges ?? currentTab.gitChanges,
      worktrees: worktrees ?? currentTab.worktrees,
      fileTree: tree?.root.children ?? currentTab.fileTree,
      changesTree: tree?.changes ?? currentTab.changesTree,
    }));
    return tree;
  }, [stateRef, updateTabRef, withServiceFallbackRef]);

  const flushWorkspaceArtifactsRefresh = useCallback(async (
    tabId: string,
  ): Promise<WorkspaceTree | null> => {
    const queuedScope = queuedRefreshScopesRef.current.get(tabId);
    if (!queuedScope || !hasArtifactRefreshWork(queuedScope)) {
      return null;
    }
    queuedRefreshScopesRef.current.delete(tabId);

    try {
      return await runWorkspaceArtifactsRefresh(tabId, queuedScope);
    } finally {
      if (queuedRefreshScopesRef.current.has(tabId)) {
        void refreshQueueRef.current?.request(tabId);
      }
    }
  }, [runWorkspaceArtifactsRefresh]);
  refreshQueueRunnerRef.current = flushWorkspaceArtifactsRefresh;

  const refreshWorkspaceArtifacts = useCallback(async (
    tabId: string,
    scope: ArtifactRefreshScope = FULL_ARTIFACT_REFRESH_SCOPE,
    immediate = false,
  ): Promise<WorkspaceTree | null> => {
    const queuedScope = queuedRefreshScopesRef.current.get(tabId) ?? {
      git: false,
      worktrees: false,
      tree: false,
    };
    queuedRefreshScopesRef.current.set(tabId, mergeArtifactRefreshScopes(queuedScope, scope));

    if (immediate) {
      return refreshQueueRef.current?.request(tabId, true) ?? flushWorkspaceArtifactsRefresh(tabId);
    }

    return refreshQueueRef.current?.request(tabId) ?? Promise.resolve(null);
  }, [flushWorkspaceArtifactsRefresh]);

  useEffect(() => {
    if (!bootstrapReady) return;
    const unsubscribe = subscribeWorkspaceArtifactsDirty((event) => {
      const scope = resolveArtifactRefreshScope(event);
      const matchingTabs = stateRef.current.tabs
        .filter((tab) => matchesWorkspaceArtifactsEvent(tab, event))
        .map((tab) => tab.id);
      matchingTabs.forEach((workspaceId) => {
        void refreshWorkspaceArtifacts(workspaceId, scope);
      });
    });
    return unsubscribe;
  }, [bootstrapReady, refreshWorkspaceArtifacts, stateRef]);

  useEffect(() => {
    if (!activeProjectPath) return;
    void refreshWorkspaceArtifacts(
      activeTabId,
      resolveInitialArtifactRefreshScope(showCodePanel, codeSidebarView),
      true,
    );
  }, [
    activeProjectPath,
    activeTabId,
    bootstrapReady,
    codeSidebarView,
    refreshWorkspaceArtifacts,
    showCodePanel,
  ]);

  useEffect(() => {
    if (!activeProjectPath || !isDocumentVisible || !isOnline) return;
    const timer = window.setInterval(() => {
      void refreshWorkspaceArtifacts(activeTabId, FULL_ARTIFACT_REFRESH_SCOPE, true);
    }, resolveArtifactFallbackPollIntervalMs());
    return () => window.clearInterval(timer);
  }, [activeProjectPath, activeTabId, isDocumentVisible, isOnline, refreshWorkspaceArtifacts]);

  useEffect(() => () => {
    refreshQueueRef.current?.dispose();
    queuedRefreshScopesRef.current.clear();
  }, []);

  return {
    refreshWorkspaceArtifacts,
  };
};
