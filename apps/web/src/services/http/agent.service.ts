import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { AgentStartResult } from "../../types/app";
import type { TerminalGridSize } from "../../shared/utils/terminal";
import { invokeRpc } from "./client";

export const startAgent = (args: {
  workspaceId: string;
  controller: WorkspaceControllerState;
  sessionId: string;
  provider: "claude";
  command: string;
  cols?: TerminalGridSize["cols"];
  rows?: TerminalGridSize["rows"];
}) => invokeRpc<AgentStartResult>(
  "agent_start",
  createWorkspaceControllerRpcPayload(args.workspaceId, args.controller, {
    sessionId: args.sessionId,
    provider: args.provider,
    command: args.command,
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
