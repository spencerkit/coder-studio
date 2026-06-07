import { createHash } from "node:crypto";
import { homedir } from "node:os";

export function resolveHomePath(path: string, home = homedir()): string {
  if (path === "~") {
    return home;
  }

  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}

export function encodeProviderWorkspacePath(workspacePath: string): string {
  return workspacePath.replaceAll("\\", "-").replaceAll("/", "-");
}

export function buildCursorWorkspaceHash(workspacePath: string): string {
  return createHash("md5").update(workspacePath).digest("hex");
}

export function parseOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function safeJsonParse<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function isWithinRange(
  startedAt: number,
  lastActiveAt: number,
  range: {
    startAt: number;
    endAt: number;
  }
): boolean {
  return lastActiveAt >= range.startAt && startedAt <= range.endAt;
}
