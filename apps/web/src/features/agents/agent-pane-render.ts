import type { Session } from "../../state/workbench.ts";
import { isDraftSession } from "../../shared/utils/session.ts";

export type AgentPaneRenderState =
  | { kind: "draft" }
  | { kind: "terminal"; terminalMode: "interactive" | "readonly" };

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
