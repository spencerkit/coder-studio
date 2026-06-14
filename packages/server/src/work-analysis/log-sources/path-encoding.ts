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

function encodeCursorProjectDir(workspacePath: string): string {
  return workspacePath
    .replace(/^[a-zA-Z]:[\\/]/, (match) => `${match[0]}-`)
    .replaceAll("\\", "-")
    .replaceAll("/", "-");
}

const NON_WORKSPACE_CURSOR_PROJECT_DIRS = new Set(["empty-window"]);

function workspacePathMatchVariants(workspacePath: string): string[] {
  const variants = new Set<string>([workspacePath]);
  if (/^[a-zA-Z]:[\\/]/.test(workspacePath)) {
    variants.add(workspacePath.replaceAll("/", "\\"));
    variants.add(workspacePath.replaceAll("\\", "/"));
  }
  return [...variants];
}

function encodedCursorProjectDirMatches(candidate: string, projectDirName: string): boolean {
  const encoded = encodeCursorProjectDir(candidate);
  return encoded === projectDirName || encoded.slice(1) === projectDirName;
}

export function decodeProviderWorkspacePathFromProjectDir(
  projectDirName: string,
  preferredPaths: string[] = []
): string | undefined {
  if (!projectDirName || NON_WORKSPACE_CURSOR_PROJECT_DIRS.has(projectDirName)) {
    return undefined;
  }

  for (const preferredPath of preferredPaths) {
    for (const candidate of workspacePathMatchVariants(preferredPath)) {
      if (encodedCursorProjectDirMatches(candidate, projectDirName)) {
        return preferredPath;
      }
    }
  }

  const candidates: string[] = [];
  const seen = new Set<string>();

  function pushCandidate(candidate: string) {
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  }

  if (projectDirName.startsWith("-")) {
    pushCandidate(`/${projectDirName.slice(1).replaceAll("-", "/")}`);
  }

  if (projectDirName.startsWith("home-")) {
    pushCandidate(`/${projectDirName.replaceAll("-", "/")}`);
  }

  const windowsMatch = /^([a-zA-Z])-(.+)$/.exec(projectDirName);
  if (windowsMatch) {
    const drive = windowsMatch[1];
    const rest = windowsMatch[2];
    if (drive !== undefined && rest !== undefined) {
      pushCandidate(`${drive}:\\${rest.replaceAll("-", "\\")}`);
    }
  }

  for (const candidate of candidates) {
    if (encodedCursorProjectDirMatches(candidate, projectDirName)) {
      return candidate;
    }
  }

  return undefined;
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
