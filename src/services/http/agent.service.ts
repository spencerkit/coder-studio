import type { AgentStartResult } from "../../types/app";
import { invokeRpc } from "./client";

export const startAgent = (args: {
  workspaceId: string;
  sessionId: string;
  provider: "claude";
  command: string;
}) => invokeRpc<AgentStartResult>("agent_start", args);

export const sendAgentInput = (workspaceId: string, sessionId: string, input: string, appendNewline: boolean) =>
  invokeRpc<void>("agent_send", { workspaceId, sessionId, input, appendNewline });

export const stopAgent = (workspaceId: string, sessionId: string) =>
  invokeRpc<void>("agent_stop", { workspaceId, sessionId });

export const resizeAgent = (workspaceId: string, sessionId: string, cols: number, rows: number) =>
  invokeRpc<void>("agent_resize", { workspaceId, sessionId, cols, rows });
