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
  private readonly filePath: string;

  constructor(input: AuthSessionRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileSessions(): Record<string, AuthSession> {
    const parsed = readJsonFile<
      AuthSessionFileRecord | Record<string, AuthSession> | AuthSession[]
    >(this.filePath);
    if (parsed !== undefined) {
      return normalizeSessionFile(parsed);
    }

    return {};
  }

  private saveFileSessions(sessions: Record<string, AuthSession>): void {
    const payload: AuthSessionFileRecord = {
      version: 1,
      sessions,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  create(token: string, now: number): AuthSession {
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
    const sessions = this.loadFileSessions();
    if (!Object.prototype.hasOwnProperty.call(sessions, token)) {
      return;
    }

    delete sessions[token];
    this.saveFileSessions(sessions);
  }
}
