import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { SessionMode } from "../../state/workbench.ts";
import type {
  BackendArchiveEntry,
  BackendSession,
  BackendSessionRestoreResult,
  SessionPatch,
  SessionRestoreResult,
} from "../../types/app.ts";
import { invokeRpc } from "./client.ts";

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
  controller: WorkspaceControllerState,
) => invokeRpc<BackendSession>(
  "create_session",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { mode }),
);

export const updateSession = (
  workspaceId: string,
  sessionId: number,
  patch: SessionPatch,
  controller: WorkspaceControllerState,
) => invokeRpc<BackendSession>(
  "session_update",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId, patch }),
);

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
