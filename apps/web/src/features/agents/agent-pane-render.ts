import type { Session, Terminal } from "../../state/workbench.ts";
import { isDraftSession } from "../../shared/utils/session.ts";

export type AgentPaneRenderState =
  | { kind: "draft" }
  | { kind: "terminal"; terminalMode: "interactive" | "readonly" };

export type AgentPaneTerminalBinding = {
  stream: string;
  streamId: string;
  syncStrategy: "incremental";
};

export const resolveAgentPaneRenderState = (
  session: Session,
  isPaneActive: boolean,
): AgentPaneRenderState => {
  if (isDraftSession(session)) {
    return { kind: "draft" };
  }

  return {
    kind: "terminal",
    terminalMode: isPaneActive ? "interactive" : "readonly",
  };
};

export const resolveAgentPaneStream = (session: Session) =>
  session.liveTerminalStream ?? session.stream;

export const resolveAgentPaneTerminalBinding = (
  session: Session,
  _terminalMode: "interactive" | "readonly",
  terminals: readonly Terminal[] = [],
): AgentPaneTerminalBinding => {
  const boundTerminal = session.terminalId
    ? terminals.find((terminal) => terminal.id === session.terminalId)
    : undefined;

  return {
    stream: boundTerminal?.output ?? session.stream,
    streamId: boundTerminal?.id ?? `${session.id}:transcript`,
    syncStrategy: "incremental",
  };
};
