import type { Database } from '../database.js';

export interface AuthSession {
  token: string;
  createdAt: number;
  lastSeenAt: number;
}

export class AuthSessionRepo {
  constructor(private readonly db: Database) {}

  create(token: string, now: number): AuthSession {
    this.db.prepare(`
      INSERT INTO auth_sessions (token, created_at, last_seen_at)
      VALUES (?, ?, ?)
    `).run(token, now, now);

    return {
      token,
      createdAt: now,
      lastSeenAt: now,
    };
  }

  touch(token: string, now: number): boolean {
    const result = this.db.prepare(`
      UPDATE auth_sessions
      SET last_seen_at = ?
      WHERE token = ?
    `).run(now, token);

    return result.changes > 0;
  }

  delete(token: string): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }
}
