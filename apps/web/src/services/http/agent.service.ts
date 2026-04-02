import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import { invokeRpc } from "./client.ts";

export const stopAgent = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<void>(
  "agent_stop",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);
