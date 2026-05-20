import type { Session, SessionState } from "@coder-studio/core";
import type { SessionUpdatePatch } from "../../session/types.js";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

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

interface StoredSession extends Session {
  archived?: boolean;
}

interface SessionFileRecord {
  version: 1;
  sessions: Record<string, StoredSession>;
}

export interface SessionRepoOptions {
  filePath: string;
  legacyDb?: Database;
  shadowDb?: Database;
}

function isDatabase(value: Database | SessionRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.terminalId === "string" &&
    typeof value.providerId === "string" &&
    typeof value.startedAt === "number" &&
    typeof value.lastActiveAt === "number" &&
    (value.capability === "full" ||
      value.capability === "limited" ||
      value.capability === "unsupported") &&
    typeof value.state === "string"
  );
}

function normalizeStoredSession(session: StoredSession): StoredSession {
  return {
    ...session,
    ...(session.title === undefined ? {} : { title: session.title }),
  };
}

function normalizeSessionFile(value: unknown): Record<string, StoredSession> {
  if (isRecord(value) && value.version === 1 && isRecord(value.sessions)) {
    const normalized: Record<string, StoredSession> = {};
    for (const entry of Object.values(value.sessions)) {
      if (isSession(entry)) {
        normalized[entry.id] = normalizeStoredSession(entry as StoredSession);
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Record<string, StoredSession> = {};
    for (const entry of value) {
      if (isSession(entry)) {
        normalized[entry.id] = normalizeStoredSession(entry as StoredSession);
      }
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalized: Record<string, StoredSession> = {};
    for (const [sessionId, entry] of Object.entries(value)) {
      if (isSession(entry)) {
        normalized[sessionId] = normalizeStoredSession({
          ...(entry as StoredSession),
          id: sessionId,
        });
      }
    }
    return normalized;
  }

  return {};
}

/**
 * Session repository for CRUD operations
 */
export class SessionRepo {
  private readonly db?: Database;
  private readonly filePath?: string;
  private readonly legacyDb?: Database;
  private readonly shadowDb?: Database;
  private shadowSynced = false;

  constructor(input: Database | SessionRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
    this.legacyDb = input.legacyDb;
    this.shadowDb = input.shadowDb;
  }

  private rowToStoredSession(row: SessionRow): StoredSession {
    return {
      ...rowToSession(row),
      ...(row.archived === 1 ? { archived: true } : {}),
    };
  }

  private readAllDbSessions(db: Database | undefined = this.db): Record<string, StoredSession> {
    const rows = db?.prepare("SELECT * FROM sessions").all() as SessionRow[] | undefined;
    const result: Record<string, StoredSession> = {};
    for (const row of rows ?? []) {
      const session = this.rowToStoredSession(row);
      result[session.id] = session;
    }
    return result;
  }

  private loadFileSessions(): Record<string, StoredSession> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<
      SessionFileRecord | Record<string, StoredSession> | StoredSession[]
    >(this.filePath);
    if (parsed !== undefined) {
      const sessions = normalizeSessionFile(parsed);
      this.ensureShadowRows(sessions);
      return sessions;
    }

    if (!this.legacyDb) {
      return {};
    }

    const migrated = this.readAllDbSessions(this.legacyDb);
    if (Object.keys(migrated).length > 0) {
      this.saveFileSessions(migrated);
    }
    this.ensureShadowRows(migrated);
    return migrated;
  }

  private saveFileSessions(sessions: Record<string, StoredSession>): void {
    if (!this.filePath) {
      return;
    }

    const payload: SessionFileRecord = {
      version: 1,
      sessions,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  private ensureShadowRows(sessions: Record<string, StoredSession>): void {
    if (!this.shadowDb || this.shadowSynced) {
      return;
    }

    for (const session of Object.values(sessions)) {
      this.upsertShadowRow(session);
    }

    this.shadowSynced = true;
  }

  private upsertShadowRow(session: StoredSession): void {
    if (!this.shadowDb) {
      return;
    }

    this.shadowDb
      .prepare(
        `INSERT INTO sessions (
           id,
           workspace_id,
           terminal_id,
           provider_id,
           capability,
           state,
           started_at,
           ended_at,
           last_active_at,
           completion_percent,
           error_reason,
           archived,
           title
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           terminal_id = excluded.terminal_id,
           provider_id = excluded.provider_id,
           capability = excluded.capability,
           state = excluded.state,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           last_active_at = excluded.last_active_at,
           completion_percent = excluded.completion_percent,
           error_reason = excluded.error_reason,
           archived = excluded.archived,
           title = excluded.title`
      )
      .run(
        session.id,
        session.workspaceId,
        session.terminalId,
        session.providerId,
        session.capability,
        session.state,
        session.startedAt,
        session.endedAt ?? null,
        session.lastActiveAt,
        session.completionPercent ?? null,
        session.errorReason ?? null,
        session.archived ? 1 : 0,
        session.title ?? null
      );
  }

  private deleteShadowRow(id: string): void {
    this.shadowDb?.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  private sortSessions(sessions: Record<string, StoredSession>): Session[] {
    return Object.values(sessions)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(({ archived: _archived, ...session }) => session);
  }

  private listAllStoredSessions(): StoredSession[] {
    return Object.values(this.loadFileSessions()).sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Lists all sessions for a workspace
   */
  listByWorkspace(workspaceId: string): Session[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC")
        .all(workspaceId) as unknown as SessionRow[];
      return rows.map(rowToSession);
    }

    return this.sortSessions(this.loadFileSessions()).filter(
      (session) => session.workspaceId === workspaceId
    );
  }

  /**
   * Finds a session by ID
   */
  findById(id: string): Session | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
        | SessionRow
        | undefined;
      return row ? rowToSession(row) : undefined;
    }

    const stored = this.loadFileSessions()[id];
    if (!stored) {
      return undefined;
    }

    const { archived: _archived, ...session } = stored;
    return session;
  }

  /**
   * Finds a session by terminal ID (1:1 relationship)
   */
  findByTerminalId(terminalId: string): Session | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM sessions WHERE terminal_id = ?").get(terminalId) as
        | SessionRow
        | undefined;
      return row ? rowToSession(row) : undefined;
    }

    const stored = this.listAllStoredSessions().find(
      (session) => session.terminalId === terminalId
    );
    if (!stored) {
      return undefined;
    }

    const { archived: _archived, ...session } = stored;
    return session;
  }

  /**
   * Lists all active (non-ended) sessions for a workspace
   */
  listActiveByWorkspace(workspaceId: string): Session[] {
    if (this.db) {
      const rows = this.db
        .prepare(
          "SELECT * FROM sessions WHERE workspace_id = ? AND ended_at IS NULL ORDER BY started_at DESC"
        )
        .all(workspaceId) as unknown as SessionRow[];
      return rows.map(rowToSession);
    }

    return this.listByWorkspace(workspaceId).filter((session) => session.endedAt == null);
  }

  /**
   * Creates a new session
   */
  create(session: NewSession): Session {
    if (this.db) {
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

    const next: StoredSession = {
      id: session.id,
      workspaceId: session.workspaceId,
      terminalId: session.terminalId,
      providerId: session.providerId,
      state: session.state,
      capability: session.capability,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      ...(session.completionPercent !== undefined
        ? { completionPercent: session.completionPercent }
        : {}),
      ...(session.errorReason !== undefined ? { errorReason: session.errorReason } : {}),
    };

    const sessions = this.loadFileSessions();
    sessions[next.id] = next;
    this.saveFileSessions(sessions);
    this.upsertShadowRow(next);

    const { archived: _archived, ...created } = next;
    return created;
  }

  insert(session: SessionRow): void {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO sessions (
             id,
             workspace_id,
             terminal_id,
             provider_id,
             capability,
             state,
             started_at,
             ended_at,
             last_active_at,
             completion_percent,
             error_reason,
             archived,
             title
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          session.id,
          session.workspace_id,
          session.terminal_id,
          session.provider_id,
          session.capability,
          session.state,
          session.started_at,
          session.ended_at,
          session.last_active_at,
          session.completion_percent,
          session.error_reason,
          session.archived,
          session.title
        );
      return;
    }

    const next: StoredSession = {
      ...rowToSession(session),
      ...(session.archived === 1 ? { archived: true } : {}),
    };

    const sessions = this.loadFileSessions();
    sessions[next.id] = next;
    this.saveFileSessions(sessions);
    this.upsertShadowRow(next);
  }

  update(id: string, patch: SessionUpdatePatch): void {
    if (this.db) {
      const keys = Object.keys(patch);
      if (keys.length === 0) return;

      const allowedCols = new Set([
        "terminal_id",
        "state",
        "started_at",
        "ended_at",
        "completion_percent",
        "error_reason",
        "last_active_at",
        "title",
      ]);

      const setClauses: string[] = [];
      const values: unknown[] = [];
      for (const key of keys) {
        const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (!allowedCols.has(col)) continue;
        setClauses.push(`${col} = ?`);
        values.push(patch[key as keyof SessionUpdatePatch] ?? null);
      }
      if (setClauses.length === 0) return;

      this.db
        .prepare(`UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`)
        .run(...(values as Array<string | number | bigint | Uint8Array | null>), id);
      return;
    }

    const sessions = this.loadFileSessions();
    const current = sessions[id];
    if (!current) {
      return;
    }

    const next: StoredSession = {
      ...current,
      ...(patch.terminalId !== undefined ? { terminalId: patch.terminalId } : {}),
      ...(patch.state !== undefined ? { state: patch.state as SessionState } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.endedAt !== undefined
        ? patch.endedAt === null
          ? { endedAt: undefined }
          : { endedAt: patch.endedAt }
        : {}),
      ...(patch.completionPercent !== undefined
        ? patch.completionPercent === null
          ? { completionPercent: undefined }
          : { completionPercent: patch.completionPercent }
        : {}),
      ...(patch.errorReason !== undefined
        ? patch.errorReason === null
          ? { errorReason: undefined }
          : { errorReason: patch.errorReason }
        : {}),
      ...(patch.lastActiveAt !== undefined ? { lastActiveAt: patch.lastActiveAt } : {}),
      ...(patch.title !== undefined
        ? patch.title === null
          ? { title: undefined }
          : { title: patch.title }
        : {}),
    };

    sessions[id] = next;
    this.saveFileSessions(sessions);
    this.upsertShadowRow(next);
  }

  findByWorkspaceId(workspaceId: string): Session[] {
    return this.listByWorkspace(workspaceId);
  }

  listHydratable(): Session[] {
    if (this.db) {
      const rows = this.db
        .prepare(
          "SELECT * FROM sessions WHERE archived = 0 AND ended_at IS NULL ORDER BY started_at DESC"
        )
        .all() as unknown as SessionRow[];
      return rows.map(rowToSession);
    }

    return this.listAllStoredSessions()
      .filter((session) => !session.archived && session.endedAt == null)
      .map(({ archived: _archived, ...session }) => session);
  }

  /**
   * Updates session state
   */
  updateState(id: string, state: SessionState): void {
    this.update(id, { state });
  }

  /**
   * Updates last active timestamp
   */
  updateLastActive(id: string, lastActiveAt: number): void {
    this.update(id, { lastActiveAt });
  }

  /**
   * Marks a session as ended
   */
  markEnded(id: string, endedAt: number): void {
    this.update(id, { endedAt, state: "ended" });
  }

  /**
   * Updates completion percent (for full capability sessions)
   */
  updateCompletionPercent(id: string, completionPercent: number): void {
    this.update(id, { completionPercent });
  }

  /**
   * Sets error reason
   */
  setError(id: string, errorReason: string): void {
    this.update(id, { errorReason });
  }

  /**
   * Archives a session
   */
  archive(id: string): void {
    if (this.db) {
      const stmt = this.db.prepare("UPDATE sessions SET archived = 1 WHERE id = ?");
      stmt.run(id);
      return;
    }

    const sessions = this.loadFileSessions();
    const current = sessions[id];
    if (!current) {
      return;
    }

    sessions[id] = {
      ...current,
      archived: true,
    };
    this.saveFileSessions(sessions);
    this.upsertShadowRow(sessions[id]);
  }

  /**
   * Deletes a session by ID
   */
  delete(id: string): void {
    if (this.db) {
      const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
      stmt.run(id);
      return;
    }

    const sessions = this.loadFileSessions();
    if (!sessions[id]) {
      return;
    }

    delete sessions[id];
    this.saveFileSessions(sessions);
    this.deleteShadowRow(id);
  }
}
