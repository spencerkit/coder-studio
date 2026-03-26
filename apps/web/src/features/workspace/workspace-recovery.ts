import type { Session, Terminal } from "../../state/workbench-core.ts";
import type { WorkspaceControllerState } from "./workspace-controller.ts";

export type AgentRecoveryAction = {
  kind: "resume" | "restart";
};

export type TerminalRecoveryAction = {
  kind: "new_terminal";
};

export const resolveAgentRecoveryAction = (
  controller: WorkspaceControllerState | null | undefined,
  session: Session | null | undefined,
): AgentRecoveryAction | null => {
  if (!controller || controller.role !== "controller" || !session) {
    return null;
  }
  if (session.status !== "interrupted") {
    return null;
  }
  return {
    kind: session.claudeSessionId ? "resume" : "restart",
  };
};

export const resolveTerminalRecoveryAction = (
  controller: WorkspaceControllerState | null | undefined,
  terminal: Terminal | null | undefined,
): TerminalRecoveryAction | null => {
  if (!controller || controller.role !== "controller" || !terminal) {
    return null;
  }
  if (terminal.recoverable) {
    return null;
  }
  return {
    kind: "new_terminal",
  };
};
