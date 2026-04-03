import type { Session, Terminal } from "../../state/workbench-core.ts";
import type { SessionRuntimeBindingInfo } from "../../types/app.ts";

export const applySessionRuntimeBindings = (
  sessions: readonly Session[],
  bindings: readonly SessionRuntimeBindingInfo[] = [],
): Session[] => {
  const bySessionId = new Map(
    bindings.map((binding) => [binding.session_id, `term-${binding.terminal_id}`]),
  );

  return sessions.map((session) => ({
    ...session,
    terminalId: bySessionId.get(session.id),
  }));
};

export const collectSessionBoundTerminalIds = (
  sessions: readonly Session[],
): Set<string> => new Set(
  sessions.flatMap((session) => (session.terminalId ? [session.terminalId] : [])),
);

export const filterWorkspacePanelTerminals = (
  terminals: readonly Terminal[],
  sessions: readonly Session[],
): Terminal[] => {
  const hiddenTerminalIds = collectSessionBoundTerminalIds(sessions);
  return terminals.filter((terminal) => !hiddenTerminalIds.has(terminal.id));
};
