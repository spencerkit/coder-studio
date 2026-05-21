import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface AuthLoginBlockRecord {
  ip: string;
  failedCount: number;
  firstFailedAt: number;
  lastFailedAt: number;
  blockedUntil: number | null;
}

interface AuthLoginBlockState {
  version: 1;
  blocks: Record<string, AuthLoginBlockRecord>;
  failures: Record<string, number[]>;
}

export interface AuthLoginBlockRepoOptions {
  filePath: string;
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

export class AuthLoginBlockRepo {
  private readonly filePath: string;

  constructor(input: AuthLoginBlockRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadState(): AuthLoginBlockState {
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
    writeJsonFileAtomic(this.filePath, {
      version: 1,
      blocks: state.blocks,
      failures: state.failures,
    } satisfies AuthLoginBlockState);
  }

  get(ip: string): AuthLoginBlockRecord | null {
    const record = this.loadState().blocks[ip];
    return record ? { ...record } : null;
  }

  upsert(record: AuthLoginBlockRecord): AuthLoginBlockRecord {
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
