import type { Session, Terminal } from "../../state/workbench-core.ts";
import type { SessionRuntimeBindingInfo } from "../../types/app.ts";

const toWorkspaceTerminalId = (binding: SessionRuntimeBindingInfo) => (
  binding.workspace_terminal_id
    ? `term-${binding.workspace_terminal_id}`
    : undefined
);

export const resolveSessionBoundTerminal = (
  sessions: readonly Session[],
  runtimeId: string,
  terminals: readonly Terminal[],
): Terminal | undefined => {
  const session = sessions.find((entry) => entry.terminalRuntimeId === runtimeId);
  if (!session) {
    return undefined;
  }
  return terminals.find((terminal) => terminal.id === runtimeId)
    ?? (session.terminalId
      ? terminals.find((terminal) => terminal.id === session.terminalId)
      : undefined);
};

export const applySessionRuntimeBindings = (
  sessions: readonly Session[],
  bindings: readonly SessionRuntimeBindingInfo[] = [],
): Session[] => {
  const bySessionId = new Map(bindings.map((binding) => [binding.session_id, binding]));

  return sessions.map((session) => {
    const binding = bySessionId.get(session.id);
    if (!binding) {
      return {
        ...session,
        terminalId: undefined,
        terminalRuntimeId: undefined,
      };
    }
    return {
      ...session,
      terminalId: toWorkspaceTerminalId(binding),
      terminalRuntimeId: binding.terminal_runtime_id ?? session.terminalRuntimeId,
    };
  });
};

export const resolveSessionTerminalIdByRuntimeId = (
  sessions: readonly Session[],
  runtimeId: string,
  terminals: readonly Terminal[] = [],
): string | undefined => resolveSessionBoundTerminal(sessions, runtimeId, terminals)?.id
  ?? sessions.find((session) => session.terminalRuntimeId === runtimeId)?.terminalId;

export const collectSessionBoundTerminalIds = (
  sessions: readonly Session[],
): Set<string> => new Set(
  sessions.flatMap((session) => (session.terminalId ? [session.terminalId] : [])),
);

export const isSessionBoundWorkspaceTerminalId = (
  sessions: readonly Session[],
  workspaceTerminalId: string,
): boolean => sessions.some(
  (session) => session.terminalId === workspaceTerminalId && session.terminalRuntimeId != null,
);

export const filterWorkspacePanelTerminals = (
  terminals: readonly Terminal[],
  sessions: readonly Session[],
): Terminal[] => {
  const hiddenTerminalIds = collectSessionBoundTerminalIds(sessions);
  return terminals.filter((terminal) => !hiddenTerminalIds.has(terminal.id));
};
