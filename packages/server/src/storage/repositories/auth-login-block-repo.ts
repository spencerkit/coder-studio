import { type Database, withTransaction } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

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

interface AuthLoginBlockState {
  version: 1;
  blocks: Record<string, AuthLoginBlockRecord>;
  failures: Record<string, number[]>;
}

export interface AuthLoginBlockRepoOptions {
  filePath: string;
}

function isDatabase(value: Database | AuthLoginBlockRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuthLoginBlockRecord(value: unknown): value is AuthLoginBlockRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.ip === "string" &&
    typeof value.failedCount === "number" &&
    typeof value.firstFailedAt === "number" &&
    typeof value.lastFailedAt === "number" &&
    (typeof value.blockedUntil === "number" || value.blockedUntil === null)
  );
}

function normalizeFailures(value: unknown): Record<string, number[]> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, number[]> = {};
  for (const [ip, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const timestamps = entry.filter((item): item is number => typeof item === "number");
    normalized[ip] = timestamps.sort((left, right) => left - right);
  }
  return normalized;
}

function normalizeState(value: unknown): AuthLoginBlockState {
  if (isRecord(value) && value.version === 1) {
    const blocks: Record<string, AuthLoginBlockRecord> = {};
    if (isRecord(value.blocks)) {
      for (const entry of Object.values(value.blocks)) {
        if (isAuthLoginBlockRecord(entry)) {
          blocks[entry.ip] = entry;
        }
      }
    }

    return {
      version: 1,
      blocks,
      failures: normalizeFailures(value.failures),
    };
  }

  if (isRecord(value)) {
    const blocks: Record<string, AuthLoginBlockRecord> = {};
    for (const [ip, entry] of Object.entries(value)) {
      if (isAuthLoginBlockRecord(entry)) {
        blocks[ip] = {
          ...entry,
          ip,
        };
      }
    }
    return {
      version: 1,
      blocks,
      failures: {},
    };
  }

  return {
    version: 1,
    blocks: {},
    failures: {},
  };
}

const toRecord = (row: AuthLoginBlockRow): AuthLoginBlockRecord => ({
  ip: row.ip,
  failedCount: row.failed_count,
  firstFailedAt: row.first_failed_at,
  lastFailedAt: row.last_failed_at,
  blockedUntil: row.blocked_until,
});

export class AuthLoginBlockRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | AuthLoginBlockRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

  private loadState(): AuthLoginBlockState {
    if (!this.filePath) {
      return {
        version: 1,
        blocks: {},
        failures: {},
      };
    }

    const parsed = readJsonFile<AuthLoginBlockState | Record<string, AuthLoginBlockRecord>>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeState(parsed);
    }

    return {
      version: 1,
      blocks: {},
      failures: {},
    };
  }

  private saveState(state: AuthLoginBlockState): void {
    if (!this.filePath) {
      return;
    }

    writeJsonFileAtomic(this.filePath, {
      version: 1,
      blocks: state.blocks,
      failures: state.failures,
    } satisfies AuthLoginBlockState);
  }

  get(ip: string): AuthLoginBlockRecord | null {
    if (this.db) {
      const row = this.db
        .prepare(`
      SELECT ip, failed_count, first_failed_at, last_failed_at, blocked_until
      FROM auth_login_blocks
      WHERE ip = ?
    `)
        .get(ip) as AuthLoginBlockRow | undefined;

      return row ? toRecord(row) : null;
    }

    const record = this.loadState().blocks[ip];
    return record ? { ...record } : null;
  }

  upsert(record: AuthLoginBlockRecord): AuthLoginBlockRecord {
    if (this.db) {
      this.db
        .prepare(`
      INSERT INTO auth_login_blocks (
        ip, failed_count, first_failed_at, last_failed_at, blocked_until
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at,
        last_failed_at = excluded.last_failed_at,
        blocked_until = excluded.blocked_until
    `)
        .run(
          record.ip,
          record.failedCount,
          record.firstFailedAt,
          record.lastFailedAt,
          record.blockedUntil
        );

      return record;
    }

    const state = this.loadState();
    state.blocks[record.ip] = { ...record };
    this.saveState(state);
    return { ...record };
  }

  recordFailure(
    ip: string,
    now: number,
    windowStart: number,
    failureLimit: number,
    blockDurationMs: number
  ): AuthLoginBlockRecord {
    if (this.db) {
      const db = this.db;
      return withTransaction(db, () => {
        db.prepare(`
        DELETE FROM auth_login_failures
        WHERE ip = ? AND failed_at < ?
      `).run(ip, windowStart);

        db.prepare(`
        INSERT INTO auth_login_failures (ip, failed_at)
        VALUES (?, ?)
      `).run(ip, now);

        const stats = db
          .prepare(`
        SELECT
          COUNT(*) AS failed_count,
          MIN(failed_at) AS first_failed_at,
          MAX(failed_at) AS last_failed_at
        FROM auth_login_failures
        WHERE ip = ?
      `)
          .get(ip) as unknown as AuthLoginFailureStatsRow;

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

    const state = this.loadState();
    const currentFailures = (state.failures[ip] ?? []).filter(
      (failedAt) => failedAt >= windowStart
    );
    currentFailures.push(now);
    currentFailures.sort((left, right) => left - right);
    state.failures[ip] = currentFailures;

    const record: AuthLoginBlockRecord = {
      ip,
      failedCount: currentFailures.length,
      firstFailedAt: currentFailures[0] ?? now,
      lastFailedAt: currentFailures[currentFailures.length - 1] ?? now,
      blockedUntil: currentFailures.length >= failureLimit ? now + blockDurationMs : null,
    };

    state.blocks[ip] = record;
    this.saveState(state);
    return { ...record };
  }

  delete(ip: string): boolean {
    if (this.db) {
      const db = this.db;
      return withTransaction(db, () => {
        const blockResult = db.prepare("DELETE FROM auth_login_blocks WHERE ip = ?").run(ip);
        const failureResult = db.prepare("DELETE FROM auth_login_failures WHERE ip = ?").run(ip);
        return Number(blockResult.changes) + Number(failureResult.changes) > 0;
      });
    }

    const state = this.loadState();
    const hadBlock = Object.prototype.hasOwnProperty.call(state.blocks, ip);
    const hadFailures = Object.prototype.hasOwnProperty.call(state.failures, ip);
    if (!hadBlock && !hadFailures) {
      return false;
    }

    delete state.blocks[ip];
    delete state.failures[ip];
    this.saveState(state);
    return true;
  }

  listActiveBlocks(now: number): AuthLoginBlockRecord[] {
    if (this.db) {
      const rows = this.db
        .prepare(`
      SELECT ip, failed_count, first_failed_at, last_failed_at, blocked_until
      FROM auth_login_blocks
      WHERE blocked_until IS NOT NULL AND blocked_until > ?
      ORDER BY blocked_until DESC, ip ASC
    `)
        .all(now) as unknown as AuthLoginBlockRow[];

      return rows.map(toRecord);
    }

    return Object.values(this.loadState().blocks)
      .filter((record) => record.blockedUntil !== null && record.blockedUntil > now)
      .sort((left, right) => {
        if (left.blockedUntil === right.blockedUntil) {
          return left.ip.localeCompare(right.ip);
        }
        return (right.blockedUntil ?? 0) - (left.blockedUntil ?? 0);
      })
      .map((record) => ({ ...record }));
  }
}
