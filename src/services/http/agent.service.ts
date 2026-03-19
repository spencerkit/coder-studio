import type { ExecTarget } from "../../state/workbench";
import type { AgentStartResult } from "../../types/app";
import { invokeRpc } from "./client";

export const startAgent = (args: {
  tabId: string;
  sessionId: string;
  provider: "claude";
  command: string;
  claudeSessionId?: string;
  cwd: string;
  target: ExecTarget;
}) => invokeRpc<AgentStartResult>("agent_start", args);

export const sendAgentInput = (tabId: string, sessionId: string, input: string, appendNewline: boolean) =>
  invokeRpc<void>("agent_send", { tabId, sessionId, input, appendNewline });

export const stopAgent = (tabId: string, sessionId: string) =>
  invokeRpc<void>("agent_stop", { tabId, sessionId });

export const resizeAgent = (tabId: string, sessionId: string, cols: number, rows: number) =>
  invokeRpc<void>("agent_resize", { tabId, sessionId, cols, rows });
