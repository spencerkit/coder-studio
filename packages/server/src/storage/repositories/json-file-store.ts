import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const WINDOWS_RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50];

function hasCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
}

function isRetriableWindowsRenameError(error: unknown): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  return [...WINDOWS_RENAME_RETRY_CODES].some((code) => hasCode(error, code));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetrySync(tempPath: string, filePath: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tempPath, filePath);
      return;
    } catch (error) {
      const delayMs = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt];

      if (!isRetriableWindowsRenameError(error) || delayMs === undefined) {
        throw error;
      }

      sleepSync(delayMs);
    }
  }
}

export function readJsonFile<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
    renameWithRetrySync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
