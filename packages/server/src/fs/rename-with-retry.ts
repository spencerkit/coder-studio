import { renameSync } from "node:fs";
import { rename } from "node:fs/promises";

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10;
const syncWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function hasCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
}

function isTransientRenameError(error: unknown): boolean {
  return ["EACCES", "EBUSY", "EPERM"].some((code) => hasCode(error, code));
}

function retryDelay(attempt: number): number {
  return DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts && isTransientRenameError(error);
}

interface AsyncRenameWithRetryOptions {
  rename?: (source: string, destination: string) => Promise<void>;
  wait?: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
}

export async function renameWithRetry(
  source: string,
  destination: string,
  options: AsyncRenameWithRetryOptions = {}
): Promise<void> {
  const renameOperation = options.rename ?? rename;
  const wait =
    options.wait ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await renameOperation(source, destination);
      return;
    } catch (error) {
      if (!shouldRetry(error, attempt, maxAttempts)) throw error;
      await wait(retryDelay(attempt));
    }
  }
}

interface SyncRenameWithRetryOptions {
  rename?: (source: string, destination: string) => void;
  wait?: (delayMs: number) => void;
  maxAttempts?: number;
}

export function renameSyncWithRetry(
  source: string,
  destination: string,
  options: SyncRenameWithRetryOptions = {}
): void {
  const renameOperation = options.rename ?? renameSync;
  const wait = options.wait ?? ((delayMs: number) => Atomics.wait(syncWaitBuffer, 0, 0, delayMs));
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      renameOperation(source, destination);
      return;
    } catch (error) {
      if (!shouldRetry(error, attempt, maxAttempts)) throw error;
      wait(retryDelay(attempt));
    }
  }
}
