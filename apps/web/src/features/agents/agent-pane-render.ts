import type { Session, Terminal } from "../../state/workbench";
import { isDraftSession } from "../../shared/utils/session";
import { resolveTerminalInteractionMode } from "../../shared/utils/terminal-interaction";

export type AgentPaneRenderState =
  | { kind: "draft" }
  | { kind: "terminal"; terminalMode: "interactive" | "readonly" };

export type AgentPaneTerminalBinding = {
  stream: string;
  streamId: string;
  syncStrategy: "incremental" | "snapshot" | "replace";
  renderMode: "terminal" | "transcript";
};

export const shouldRenderAgentPaneTranscript = (
  _provider: Session["provider"],
) => false;

export const resolveAgentPaneRenderState = (
  session: Session,
  isPaneActive: boolean,
  inputEnabled = true,
): AgentPaneRenderState => {
  if (isDraftSession(session)) {
    return { kind: "draft" };
  }

  return {
    kind: "terminal",
    terminalMode: resolveTerminalInteractionMode(isPaneActive, inputEnabled),
  };
};

export const resolveAgentPaneStream = (session: Session) => session.stream;
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
    syncStrategy: boundTerminal ? "snapshot" : "incremental",
    renderMode: "terminal",
  };
};
