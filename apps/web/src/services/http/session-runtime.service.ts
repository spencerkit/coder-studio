import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { SessionRuntimeStartResult } from "../../types/app.ts";
import { invokeRpc } from "./client.ts";

export type SessionRuntimeStartRequest = {
  workspaceId: string;
  controller: WorkspaceControllerState;
  sessionId: string;
  cols?: number;
  rows?: number;
};

export const startSessionRuntime = (args: SessionRuntimeStartRequest) => invokeRpc<SessionRuntimeStartResult>(
  "session_runtime_start",
  createWorkspaceControllerRpcPayload(args.workspaceId, args.controller, {
    sessionId: args.sessionId,
    cols: args.cols,
    rows: args.rows,
  }),
);
