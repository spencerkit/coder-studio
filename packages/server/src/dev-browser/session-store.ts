import { randomUUID } from "node:crypto";
import type { DevBrowserTarget } from "./target-url.js";

export interface DevBrowserSession extends DevBrowserTarget {
  createdAt: number;
  expiresAt: number;
  id: string;
  lastAccessedAt: number;
  preserveStudioPlatformPaths?: boolean;
  userAgent?: string;
}

export interface DevBrowserSessionStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

export interface CreateDevBrowserSessionInput extends DevBrowserTarget {
  userAgent?: string;
}

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

function cloneSession(session: DevBrowserSession): DevBrowserSession {
  return { ...session };
}

export class DevBrowserSessionStore {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #sessions = new Map<string, DevBrowserSession>();

  constructor(options: DevBrowserSessionStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  create(target: CreateDevBrowserSessionInput): DevBrowserSession {
    const now = this.#now();
    const session: DevBrowserSession = {
      ...target,
      id: `dev_${randomUUID()}`,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.#sessions.set(session.id, session);
    return cloneSession(session);
  }

  get(id: string): DevBrowserSession | null {
    const session = this.#sessions.get(id);
    if (!session) {
      return null;
    }

    const now = this.#now();
    if (session.expiresAt <= now) {
      this.#sessions.delete(id);
      return null;
    }

    const nextSession: DevBrowserSession = {
      ...session,
      lastAccessedAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.#sessions.set(id, nextSession);
    return cloneSession(nextSession);
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id);
  }
}
