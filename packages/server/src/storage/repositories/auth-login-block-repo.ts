import { withTransaction, type Database } from '../database.js';

export interface AuthLoginBlockRecord {
  ip: string;
  failedCount: number;
  firstFailedAt: number;
  lastFailedAt: number;
  blockedUntil: number | null;
}

interface AuthLoginBlockRow {
  ip: string;
  failed_count: number;
  first_failed_at: number;
  last_failed_at: number;
  blocked_until: number | null;
}

interface AuthLoginFailureStatsRow {
  failed_count: number;
  first_failed_at: number | null;
  last_failed_at: number | null;
}

const toRecord = (row: AuthLoginBlockRow): AuthLoginBlockRecord => ({
  ip: row.ip,
  failedCount: row.failed_count,
  firstFailedAt: row.first_failed_at,
  lastFailedAt: row.last_failed_at,
  blockedUntil: row.blocked_until,
});

export class AuthLoginBlockRepo {
  constructor(private readonly db: Database) {}

  get(ip: string): AuthLoginBlockRecord | null {
    const row = this.db.prepare(`
      SELECT ip, failed_count, first_failed_at, last_failed_at, blocked_until
      FROM auth_login_blocks
      WHERE ip = ?
    `).get(ip) as AuthLoginBlockRow | undefined;

    return row ? toRecord(row) : null;
  }

  upsert(record: AuthLoginBlockRecord): AuthLoginBlockRecord {
    this.db.prepare(`
      INSERT INTO auth_login_blocks (
        ip, failed_count, first_failed_at, last_failed_at, blocked_until
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at,
        last_failed_at = excluded.last_failed_at,
        blocked_until = excluded.blocked_until
    `).run(
      record.ip,
      record.failedCount,
      record.firstFailedAt,
      record.lastFailedAt,
      record.blockedUntil
    );

    return record;
  }

  recordFailure(
    ip: string,
    now: number,
    windowStart: number,
    failureLimit: number,
    blockDurationMs: number
  ): AuthLoginBlockRecord {
    return withTransaction(this.db, () => {
      this.db.prepare(`
        DELETE FROM auth_login_failures
        WHERE ip = ? AND failed_at < ?
      `).run(ip, windowStart);

      this.db.prepare(`
        INSERT INTO auth_login_failures (ip, failed_at)
        VALUES (?, ?)
      `).run(ip, now);

      const stats = this.db.prepare(`
        SELECT
          COUNT(*) AS failed_count,
          MIN(failed_at) AS first_failed_at,
          MAX(failed_at) AS last_failed_at
        FROM auth_login_failures
        WHERE ip = ?
      `).get(ip) as unknown as AuthLoginFailureStatsRow;

      const record: AuthLoginBlockRecord = {
        ip,
        failedCount: stats.failed_count,
        firstFailedAt: stats.first_failed_at ?? now,
        lastFailedAt: stats.last_failed_at ?? now,
        blockedUntil: stats.failed_count >= failureLimit ? now + blockDurationMs : null,
      };

      return this.upsert(record);
    });
  }

  delete(ip: string): boolean {
    return withTransaction(this.db, () => {
      const blockResult = this.db.prepare('DELETE FROM auth_login_blocks WHERE ip = ?').run(ip);
      const failureResult = this.db.prepare('DELETE FROM auth_login_failures WHERE ip = ?').run(ip);
      return Number(blockResult.changes) + Number(failureResult.changes) > 0;
    });
  }

  listActiveBlocks(now: number): AuthLoginBlockRecord[] {
    const rows = this.db.prepare(`
      SELECT ip, failed_count, first_failed_at, last_failed_at, blocked_until
      FROM auth_login_blocks
      WHERE blocked_until IS NOT NULL AND blocked_until > ?
      ORDER BY blocked_until DESC, ip ASC
    `).all(now) as unknown as AuthLoginBlockRow[];

    return rows.map(toRecord);
  }
}
