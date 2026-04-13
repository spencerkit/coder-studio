import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller";
import { invokeRpc } from "./client";

export const stopAgent = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<void>(
  "agent_stop",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);
