import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renameSyncWithRetry } from "../../fs/rename-with-retry.js";

function hasCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
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
    renameSyncWithRetry(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
