import type { Session } from "../../state/workbench-core";
import type { WorkspaceControllerState } from "./workspace-controller";

export type AgentRecoveryAction = {
  kind: "resume" | "restart";
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
  if (session.terminalId) {
    return null;
  }
  return {
    kind: session.resumeId ? "resume" : "restart",
  };
};
