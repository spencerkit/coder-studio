import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface AuthSession {
  token: string;
  createdAt: number;
  lastSeenAt: number;
}

interface AuthSessionFileRecord {
  version: 1;
  sessions: Record<string, AuthSession>;
}

export interface AuthSessionRepoOptions {
  filePath: string;
}

function isDatabase(value: Database | AuthSessionRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.token === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.lastSeenAt === "number"
  );
}

function normalizeSessionFile(value: unknown): Record<string, AuthSession> {
  if (isRecord(value) && value.version === 1 && isRecord(value.sessions)) {
    const normalized: Record<string, AuthSession> = {};
    for (const entry of Object.values(value.sessions)) {
      if (isAuthSession(entry)) {
        normalized[entry.token] = entry;
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    const normalized: Record<string, AuthSession> = {};
    for (const entry of value) {
      if (isAuthSession(entry)) {
        normalized[entry.token] = entry;
      }
    }
    return normalized;
  }

  if (isRecord(value)) {
    const normalized: Record<string, AuthSession> = {};
    for (const [token, entry] of Object.entries(value)) {
      if (isAuthSession(entry)) {
        normalized[token] = {
          ...entry,
          token,
        };
      }
    }
    return normalized;
  }

  return {};
}

export class AuthSessionRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | AuthSessionRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

  private loadFileSessions(): Record<string, AuthSession> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<
      AuthSessionFileRecord | Record<string, AuthSession> | AuthSession[]
    >(this.filePath);
    if (parsed !== undefined) {
      return normalizeSessionFile(parsed);
    }

    return {};
  }

  private saveFileSessions(sessions: Record<string, AuthSession>): void {
    if (!this.filePath) {
      return;
    }

    const payload: AuthSessionFileRecord = {
      version: 1,
      sessions,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  create(token: string, now: number): AuthSession {
    if (this.db) {
      this.db
        .prepare(`
      INSERT INTO auth_sessions (token, created_at, last_seen_at)
      VALUES (?, ?, ?)
    `)
        .run(token, now, now);

      return {
        token,
        createdAt: now,
        lastSeenAt: now,
      };
    }

    const sessions = this.loadFileSessions();
    const session: AuthSession = {
      token,
      createdAt: now,
      lastSeenAt: now,
    };
    sessions[token] = session;
    this.saveFileSessions(sessions);
    return session;
  }

  touch(token: string, now: number): boolean {
    if (this.db) {
      const result = this.db
        .prepare(`
      UPDATE auth_sessions
      SET last_seen_at = ?
      WHERE token = ?
    `)
        .run(now, token);

      return result.changes > 0;
    }

    const sessions = this.loadFileSessions();
    const existing = sessions[token];
    if (!existing) {
      return false;
    }

    sessions[token] = {
      ...existing,
      lastSeenAt: now,
    };
    this.saveFileSessions(sessions);
    return true;
  }

  delete(token: string): void {
    if (this.db) {
      this.db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
      return;
    }

    const sessions = this.loadFileSessions();
    if (!Object.prototype.hasOwnProperty.call(sessions, token)) {
      return;
    }

    delete sessions[token];
    this.saveFileSessions(sessions);
  }
}
