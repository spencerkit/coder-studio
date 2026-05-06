import type { Session, SessionState } from "@coder-studio/core";
import type { Database } from "../database.js";

/**
 * Database row representation for Session table
 */
export interface SessionRow {
  id: string;
  workspace_id: string;
  terminal_id: string;
  provider_id: string;
  capability: "full" | "limited" | "unsupported";
  state: SessionState;
  started_at: number | null;
  ended_at: number | null;
  last_active_at: number;
  completion_percent: number | null;
  error_reason: string | null;
  archived: number; // SQLite uses 0/1 for boolean
  title: string | null;
  draft?: string | null;
}

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    terminalId: row.terminal_id,
    providerId: row.provider_id,
    state: row.state,
    capability: row.capability,
    startedAt: row.started_at ?? row.last_active_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at ?? undefined,
    completionPercent: row.completion_percent ?? undefined,
    errorReason: row.error_reason ?? undefined,
    title: row.title ?? undefined,
    ...(row.draft != null ? { draft: row.draft } : {}),
  };
}

export function sessionToRow(session: Session & { draft?: string }): SessionRow {
  return {
    id: session.id,
    workspace_id: session.workspaceId,
    terminal_id: session.terminalId,
    provider_id: session.providerId,
    state: session.state,
    capability: session.capability,
    started_at: session.startedAt ?? session.lastActiveAt,
    last_active_at: session.lastActiveAt,
    ended_at: session.endedAt ?? null,
    completion_percent: session.completionPercent ?? null,
    error_reason: session.errorReason ?? null,
    archived: 0,
    draft: session.draft ?? null,
    title: session.title ?? null,
  };
}

/**
 * Input type for creating a new session
 */
export interface NewSession {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  capability: "full" | "limited" | "unsupported";
  startedAt: number;
  lastActiveAt: number;
  completionPercent?: number;
  errorReason?: string;
}

/**
 * Session repository for CRUD operations
 */
export class SessionRepo {
  constructor(private db: Database) {}

  /**
   * Lists all sessions for a workspace
   */
  listByWorkspace(workspaceId: string): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC")
      .all(workspaceId) as unknown as SessionRow[];
    return rows.map(rowToSession);
  }

  /**
   * Finds a session by ID
   */
  findById(id: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? rowToSession(row) : undefined;
  }

  /**
   * Finds a session by terminal ID (1:1 relationship)
   */
  findByTerminalId(terminalId: string): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE terminal_id = ?").get(terminalId) as
      | SessionRow
      | undefined;
    return row ? rowToSession(row) : undefined;
  }

  /**
   * Lists all active (non-ended) sessions for a workspace
   */
  listActiveByWorkspace(workspaceId: string): Session[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE workspace_id = ? AND ended_at IS NULL ORDER BY started_at DESC"
      )
      .all(workspaceId) as unknown as SessionRow[];
    return rows.map(rowToSession);
  }

  /**
   * Creates a new session
   */
  create(session: NewSession): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at, completion_percent, error_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.workspaceId,
      session.terminalId,
      session.providerId,
      session.capability,
      session.state,
      session.startedAt,
      session.lastActiveAt,
      session.completionPercent ?? null,
      session.errorReason ?? null
    );

    return this.findById(session.id)!;
  }

  /**
   * Updates session state
   */
  updateState(id: string, state: SessionState): void {
    const stmt = this.db.prepare("UPDATE sessions SET state = ? WHERE id = ?");
    stmt.run(state, id);
  }

  /**
   * Updates last active timestamp
   */
  updateLastActive(id: string, lastActiveAt: number): void {
    const stmt = this.db.prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?");
    stmt.run(lastActiveAt, id);
  }

  /**
   * Marks a session as ended
   */
  markEnded(id: string, endedAt: number): void {
    const stmt = this.db.prepare("UPDATE sessions SET ended_at = ?, state = ? WHERE id = ?");
    stmt.run(endedAt, "ended", id);
  }

  /**
   * Updates completion percent (for full capability sessions)
   */
  updateCompletionPercent(id: string, completionPercent: number): void {
    const stmt = this.db.prepare("UPDATE sessions SET completion_percent = ? WHERE id = ?");
    stmt.run(completionPercent, id);
  }

  /**
   * Sets error reason
   */
  setError(id: string, errorReason: string): void {
    const stmt = this.db.prepare("UPDATE sessions SET error_reason = ? WHERE id = ?");
    stmt.run(errorReason, id);
  }

  /**
   * Archives a session
   */
  archive(id: string): void {
    const stmt = this.db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?");
    stmt.run(id);
  }

  /**
   * Deletes a session by ID
   */
  delete(id: string): void {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    stmt.run(id);
  }
}
