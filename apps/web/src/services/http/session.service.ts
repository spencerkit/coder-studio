import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller";
import type { AgentProvider, SessionMode } from "../../state/workbench";
import type {
  BackendArchiveEntry,
  BackendSession,
  BackendSessionRestoreResult,
  SessionPatch,
  SessionRestoreResult,
} from "../../types/app";
import { invokeRpc } from "./client";
import { sendWsMessage } from "../../ws/client";
import { sendWsMutationWithNullableHttpFallback } from "./ws-rpc-fallback";

type ScheduleTimeout = (callback: () => void, delayMs: number) => unknown;
type CancelTimeout = (handle: unknown) => void;

type SessionActivityPersistScheduler<TController> = {
  schedule: (
    workspaceId: string,
    sessionId: number,
    lastActiveAt: number,
    controller: TController,
  ) => void;
  takeLastActiveAt: (workspaceId: string, sessionId: number) => number | undefined;
  dispose: () => void;
};

export const SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS = 1500;

const sessionActivityKey = (workspaceId: string, sessionId: number) => `${workspaceId}:${sessionId}`;

const isLastActiveOnlySessionPatch = (patch: SessionPatch) => {
  const keys = Object.entries(patch)
    .filter(([, value]) => typeof value !== "undefined")
    .map(([key]) => key);
  return keys.length === 1 && keys[0] === "last_active_at" && typeof patch.last_active_at === "number";
};

export const createSessionActivityPersistScheduler = <TController>(
  persist: (
    workspaceId: string,
    sessionId: number,
    patch: SessionPatch,
    controller: TController,
  ) => void | Promise<unknown>,
  scheduleTimeout: ScheduleTimeout,
  cancelTimeout: CancelTimeout,
  delayMs = SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS,
): SessionActivityPersistScheduler<TController> => {
  const pending = new Map<string, {
    handle: unknown;
    workspaceId: string;
    sessionId: number;
    lastActiveAt: number;
    controller: TController;
  }>();

  const clearPending = (workspaceId: string, sessionId: number) => {
    const key = sessionActivityKey(workspaceId, sessionId);
    const entry = pending.get(key);
    if (!entry) return undefined;
    cancelTimeout(entry.handle);
    pending.delete(key);
    return entry;
  };

  return {
    schedule(workspaceId, sessionId, lastActiveAt, controller) {
      clearPending(workspaceId, sessionId);
      const key = sessionActivityKey(workspaceId, sessionId);
      const handle = scheduleTimeout(() => {
        pending.delete(key);
        void persist(workspaceId, sessionId, { last_active_at: lastActiveAt }, controller);
      }, delayMs);
      pending.set(key, {
        handle,
        workspaceId,
        sessionId,
        lastActiveAt,
        controller,
      });
    },
    takeLastActiveAt(workspaceId, sessionId) {
      return clearPending(workspaceId, sessionId)?.lastActiveAt;
    },
    dispose() {
      Array.from(pending.values()).forEach((entry) => {
        cancelTimeout(entry.handle);
      });
      pending.clear();
    },
  };
};

const sendSessionUpdateMutation = (
  workspaceId: string,
  sessionId: number,
  patch: SessionPatch,
  controller: WorkspaceControllerState,
) => sendWsMutationWithNullableHttpFallback(
  () => sendWsMessage({
    type: "session_update",
    workspace_id: workspaceId,
    session_id: sessionId,
    patch,
    fencing_token: controller.fencingToken,
  }),
  () => invokeRpc<BackendSession>(
    "session_update",
    createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId, patch }),
  ),
);

const sessionActivityPersistScheduler = createSessionActivityPersistScheduler(
  sendSessionUpdateMutation,
  (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
);

const createOptionalHistoryMutationPayload = (
  workspaceId: string,
  sessionId: number,
  controller?: WorkspaceControllerState | null,
) => (
  controller?.role === "controller"
    ? createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId })
    : { workspaceId, sessionId }
);

export const createSession = (
  workspaceId: string,
  mode: SessionMode,
  provider: AgentProvider,
  controller: WorkspaceControllerState,
) => invokeRpc<BackendSession>(
  "create_session",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { mode, provider }),
);

export const updateSession = (
  workspaceId: string,
  sessionId: number,
  patch: SessionPatch,
  controller: WorkspaceControllerState,
) => {
  if (isLastActiveOnlySessionPatch(patch)) {
    sessionActivityPersistScheduler.schedule(
      workspaceId,
      sessionId,
      patch.last_active_at!,
      controller,
    );
    return Promise.resolve(null);
  }

  const pendingLastActiveAt = sessionActivityPersistScheduler.takeLastActiveAt(workspaceId, sessionId);
  const mergedPatch = typeof pendingLastActiveAt === "number"
    && (typeof patch.last_active_at !== "number" || pendingLastActiveAt > patch.last_active_at)
    ? { ...patch, last_active_at: pendingLastActiveAt }
    : patch;

  return sendSessionUpdateMutation(workspaceId, sessionId, mergedPatch, controller);
};

export const switchSession = (
  workspaceId: string,
  sessionId: number,
  controller: WorkspaceControllerState,
) => invokeRpc<BackendSession>(
  "switch_session",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const archiveSession = (
  workspaceId: string,
  sessionId: number,
  controller: WorkspaceControllerState,
) => invokeRpc<BackendArchiveEntry>(
  "archive_session",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const restoreSession = async (
  workspaceId: string,
  sessionId: number,
  controller?: WorkspaceControllerState | null,
): Promise<SessionRestoreResult> => {
  const result = await invokeRpc<BackendSessionRestoreResult>(
    "restore_session",
    createOptionalHistoryMutationPayload(workspaceId, sessionId, controller),
  );
  return {
    session: result.session,
    alreadyActive: result.already_active,
  };
};

export const deleteSession = (
  workspaceId: string,
  sessionId: number,
  controller?: WorkspaceControllerState | null,
) => invokeRpc<void>(
  "delete_session",
  createOptionalHistoryMutationPayload(workspaceId, sessionId, controller),
);

export const updateIdlePolicy = (workspaceId: string, policy: {
  enabled: boolean;
  idleMinutes: number;
  maxActive: number;
  pressure: boolean;
}, controller: WorkspaceControllerState) =>
  invokeRpc<void>("update_idle_policy", createWorkspaceControllerRpcPayload(workspaceId, controller, { policy }));
