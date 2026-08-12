import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IN_MEMORY_STATE_DIR } from "@coder-studio/core/state-paths";

interface StateLockRecord {
  pid: number;
  token: string;
  startedAt: number;
}

export interface StateLockOptions {
  pid?: number;
  isProcessRunning?: (pid: number) => boolean;
}

export interface StateLockHandle {
  path: string | null;
  release(): void;
}

function defaultIsProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): StateLockRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<StateLockRecord>;
    if (
      !Number.isInteger(value.pid) ||
      typeof value.token !== "string" ||
      typeof value.startedAt !== "number"
    ) {
      return null;
    }
    return value as StateLockRecord;
  } catch {
    return null;
  }
}

export function acquireStateLock(
  stateDir: string,
  options: StateLockOptions = {}
): StateLockHandle {
  if (stateDir === IN_MEMORY_STATE_DIR) {
    return { path: null, release: () => undefined };
  }

  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "server.lock");
  const pid = options.pid ?? process.pid;
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const record: StateLockRecord = {
    pid,
    token: randomUUID(),
    startedAt: Date.now(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, JSON.stringify(record, null, 2), "utf8");
      } finally {
        closeSync(fd);
      }

      let released = false;
      return {
        path,
        release: () => {
          if (released) return;
          released = true;
          const current = readLock(path);
          if (current?.token === record.token) rmSync(path, { force: true });
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      const existing = readLock(path);
      if (existing && isProcessRunning(existing.pid)) {
        throw new Error(
          `Coder Studio state directory is already in use by process ${existing.pid}: ${stateDir}`
        );
      }
      rmSync(path, { force: true });
    }
  }

  throw new Error(`Unable to acquire Coder Studio state lock: ${stateDir}`);
}
