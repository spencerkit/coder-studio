import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { AgentStartResult } from "../../types/app";
import type { TerminalGridSize } from "../../shared/utils/terminal";
import { invokeRpc } from "./client.ts";

export type AgentStartRequest = {
  workspaceId: string;
  controller: WorkspaceControllerState;
  sessionId: string;
  provider: "claude";
  cols?: TerminalGridSize["cols"];
  rows?: TerminalGridSize["rows"];
};

// Claude launch settings are resolved on the server from persisted app settings.
// The frontend intentionally never sends a launch command here.
export const startAgent = (args: AgentStartRequest) => invokeRpc<AgentStartResult>(
  "agent_start",
  createWorkspaceControllerRpcPayload(args.workspaceId, args.controller, {
    sessionId: args.sessionId,
    provider: args.provider,
    cols: args.cols,
    rows: args.rows,
  }),
);

export const sendAgentInput = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
  input: string,
  appendNewline: boolean,
) => invokeRpc<void>(
  "agent_send",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId, input, appendNewline }),
);

export const stopAgent = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<void>(
  "agent_stop",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const resizeAgent = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
  cols: number,
  rows: number,
) => invokeRpc<void>(
  "agent_resize",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId, cols, rows }),
);
