import type { Session, Terminal } from "@coder-studio/core";

function upsertByWorkspaceId<T extends { id: string; workspaceId: string }>(
  outer: Map<string, Map<string, T>>,
  index: Map<string, string>,
  value: T
): void {
  const previousWorkspaceId = index.get(value.id);
  if (previousWorkspaceId && previousWorkspaceId !== value.workspaceId) {
    outer.get(previousWorkspaceId)?.delete(value.id);
  }

  index.set(value.id, value.workspaceId);
  const bucket = outer.get(value.workspaceId) ?? new Map<string, T>();
  bucket.set(value.id, value);
  outer.set(value.workspaceId, bucket);
}

export class WorkspaceRuntimeBindingStore {
  private readonly runtimeIdByWorkspaceId = new Map<string, string>();
  private readonly workspaceIdBySessionId = new Map<string, string>();
  private readonly workspaceIdByTerminalId = new Map<string, string>();
  private readonly sessionIdByTerminalId = new Map<string, string>();
  private readonly sessionsByWorkspaceId = new Map<string, Map<string, Session>>();
  private readonly terminalsByWorkspaceId = new Map<string, Map<string, Terminal>>();

  bindWorkspace(workspaceId: string, runtimeId: string): void {
    this.runtimeIdByWorkspaceId.set(workspaceId, runtimeId);
  }

  unbindWorkspace(workspaceId: string): void {
    this.runtimeIdByWorkspaceId.delete(workspaceId);

    const sessions = this.sessionsByWorkspaceId.get(workspaceId);
    for (const session of sessions?.values() ?? []) {
      this.workspaceIdBySessionId.delete(session.id);
      if (this.sessionIdByTerminalId.get(session.terminalId) === session.id) {
        this.sessionIdByTerminalId.delete(session.terminalId);
      }
    }

    const terminals = this.terminalsByWorkspaceId.get(workspaceId);
    for (const terminalId of terminals?.keys() ?? []) {
      this.workspaceIdByTerminalId.delete(terminalId);
    }

    this.sessionsByWorkspaceId.delete(workspaceId);
    this.terminalsByWorkspaceId.delete(workspaceId);
  }

  getRuntimeIdForWorkspace(workspaceId: string): string | undefined {
    return this.runtimeIdByWorkspaceId.get(workspaceId);
  }

  bindSession(session: Session): void {
    const previousWorkspaceId = this.workspaceIdBySessionId.get(session.id);
    const previousSession = previousWorkspaceId
      ? this.sessionsByWorkspaceId.get(previousWorkspaceId)?.get(session.id)
      : undefined;

    if (
      previousSession &&
      previousSession.terminalId !== session.terminalId &&
      this.sessionIdByTerminalId.get(previousSession.terminalId) === session.id
    ) {
      this.sessionIdByTerminalId.delete(previousSession.terminalId);
    }

    upsertByWorkspaceId(this.sessionsByWorkspaceId, this.workspaceIdBySessionId, session);
    this.sessionIdByTerminalId.set(session.terminalId, session.id);
  }

  removeSession(sessionId: string): void {
    const workspaceId = this.workspaceIdBySessionId.get(sessionId);
    if (!workspaceId) {
      return;
    }

    const session = this.sessionsByWorkspaceId.get(workspaceId)?.get(sessionId);
    if (session && this.sessionIdByTerminalId.get(session.terminalId) === sessionId) {
      this.sessionIdByTerminalId.delete(session.terminalId);
    }

    this.workspaceIdBySessionId.delete(sessionId);
    this.sessionsByWorkspaceId.get(workspaceId)?.delete(sessionId);
  }

  findWorkspaceIdBySessionId(sessionId: string): string | undefined {
    return this.workspaceIdBySessionId.get(sessionId);
  }

  listSessionsForWorkspace(workspaceId: string): Session[] {
    return Array.from(this.sessionsByWorkspaceId.get(workspaceId)?.values() ?? []);
  }

  findSessionIdByTerminalId(terminalId: string): string | undefined {
    return this.sessionIdByTerminalId.get(terminalId);
  }

  bindTerminal(terminal: Terminal): void {
    upsertByWorkspaceId(this.terminalsByWorkspaceId, this.workspaceIdByTerminalId, terminal);
  }

  removeTerminal(terminalId: string): void {
    const workspaceId = this.workspaceIdByTerminalId.get(terminalId);
    if (!workspaceId) {
      return;
    }

    this.workspaceIdByTerminalId.delete(terminalId);
    this.terminalsByWorkspaceId.get(workspaceId)?.delete(terminalId);
  }

  findWorkspaceIdByTerminalId(terminalId: string): string | undefined {
    return this.workspaceIdByTerminalId.get(terminalId);
  }

  listTerminalsForWorkspace(workspaceId: string): Terminal[] {
    return Array.from(this.terminalsByWorkspaceId.get(workspaceId)?.values() ?? []);
  }
}
