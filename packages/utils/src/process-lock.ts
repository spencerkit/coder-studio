import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ProcessLockOptions {
  lockPath: string;
  pid?: number;
  now?: () => number;
  metadata?: Record<string, unknown>;
  processExists?: (pid: number) => boolean;
}

export class ProcessLockError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly ownerPid: number
  ) {
    super(`Runtime state directory is already in use by pid ${ownerPid}`);
  }
}

function defaultProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireProcessLock(options: ProcessLockOptions): () => void {
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => Date.now());
  const processExists = options.processExists ?? defaultProcessExists;

  if (existsSync(options.lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(options.lockPath, "utf8")) as { pid?: unknown };
      if (typeof existing.pid === "number" && processExists(existing.pid)) {
        throw new ProcessLockError(options.lockPath, existing.pid);
      }
    } catch (error) {
      if (error instanceof ProcessLockError) {
        throw error;
      }
    }

    try {
      unlinkSync(options.lockPath);
    } catch (error) {
      const candidate = error as { code?: string };
      if (candidate.code !== "ENOENT") {
        throw error;
      }
    }
  }

  mkdirSync(dirname(options.lockPath), { recursive: true });
  writeFileSync(
    options.lockPath,
    JSON.stringify(
      {
        pid,
        acquiredAt: now(),
        ...(options.metadata ?? {}),
      },
      null,
      2
    ),
    "utf8"
  );

  return () => {
    try {
      unlinkSync(options.lockPath);
    } catch (error) {
      const candidate = error as { code?: string };
      if (candidate.code !== "ENOENT") {
        throw error;
      }
    }
  };
}
