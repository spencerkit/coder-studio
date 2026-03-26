import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { SessionMode } from "../../state/workbench.ts";
import type { BackendArchiveEntry, BackendSession, SessionPatch } from "../../types/app.ts";
import { invokeRpc } from "./client.ts";

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

export const updateIdlePolicy = (workspaceId: string, policy: {
  enabled: boolean;
  idleMinutes: number;
  maxActive: number;
  pressure: boolean;
}, controller: WorkspaceControllerState) =>
  invokeRpc<void>("update_idle_policy", createWorkspaceControllerRpcPayload(workspaceId, controller, { policy }));
