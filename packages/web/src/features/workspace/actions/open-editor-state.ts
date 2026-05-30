import type { Workspace } from "@coder-studio/core";
import type { Store } from "jotai/vanilla/store";
import { activeFilePathAtomFamily, openEditorPathsAtomFamily } from "../atoms";

function hasOwnProperty<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeOpenEditorPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0 || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    next.push(entry);
  }

  return next;
}

export function normalizeActiveEditorPath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value;
}

export function mergeOpenEditorPaths(...pathLists: Array<Iterable<string> | undefined>): string[] {
  return normalizeOpenEditorPaths(pathLists.flatMap((paths) => (paths ? Array.from(paths) : [])));
}

export function appendOpenEditorPath(paths: Iterable<string>, path: string): string[] {
  return mergeOpenEditorPaths(paths, [path]);
}

export function removeOpenEditorPaths(
  paths: Iterable<string>,
  removedPaths: Iterable<string>
): string[] {
  const removed = new Set(removedPaths);
  return normalizeOpenEditorPaths(Array.from(paths)).filter((path) => !removed.has(path));
}

export function rewriteDescendantEditorPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path;
}

export function rewriteOpenEditorPaths(
  paths: Iterable<string>,
  fromPath: string,
  toPath: string
): string[] {
  return normalizeOpenEditorPaths(
    Array.from(paths).map((path) => rewriteDescendantEditorPath(path, fromPath, toPath))
  );
}

export function normalizeWorkspaceEditorUiStatePatch(
  uiState: Partial<Pick<Workspace["uiState"], "openEditorPaths" | "activeEditorPath">>
): { openEditorPaths?: string[]; activeEditorPath?: string | null } | null {
  const hasOpenEditorPaths = hasOwnProperty(uiState, "openEditorPaths");
  const hasActiveEditorPath = hasOwnProperty(uiState, "activeEditorPath");

  if (!hasOpenEditorPaths && !hasActiveEditorPath) {
    return null;
  }

  const next: { openEditorPaths?: string[]; activeEditorPath?: string | null } = {};

  if (hasOpenEditorPaths) {
    const openEditorPaths = normalizeOpenEditorPaths(uiState.openEditorPaths);
    next.openEditorPaths = openEditorPaths;

    if (hasActiveEditorPath) {
      const activeEditorPath = normalizeActiveEditorPath(uiState.activeEditorPath);
      next.activeEditorPath = activeEditorPath;

      if (activeEditorPath && !openEditorPaths.includes(activeEditorPath)) {
        next.openEditorPaths = [...openEditorPaths, activeEditorPath];
      }
    }
  } else if (hasActiveEditorPath) {
    next.activeEditorPath = normalizeActiveEditorPath(uiState.activeEditorPath);
  }

  return next;
}

export function normalizeWorkspaceEditorUiState(
  uiState: Workspace["uiState"]
): Workspace["uiState"] {
  const normalizedPatch = normalizeWorkspaceEditorUiStatePatch(uiState);
  if (!normalizedPatch) {
    return uiState;
  }

  return {
    ...uiState,
    ...(hasOwnProperty(normalizedPatch, "openEditorPaths")
      ? { openEditorPaths: normalizedPatch.openEditorPaths }
      : {}),
    ...(hasOwnProperty(normalizedPatch, "activeEditorPath")
      ? { activeEditorPath: normalizedPatch.activeEditorPath }
      : {}),
  };
}

export function hydrateWorkspaceEditorState(
  store: Store,
  workspaceId: string,
  uiState?: Partial<Workspace["uiState"]> | null
): void {
  if (!uiState) {
    return;
  }

  const hasOpenEditorPaths = hasOwnProperty(uiState, "openEditorPaths");
  const hasActiveEditorPath = hasOwnProperty(uiState, "activeEditorPath");
  if (!hasOpenEditorPaths && !hasActiveEditorPath) {
    return;
  }

  const normalizedPatch = normalizeWorkspaceEditorUiStatePatch(uiState);
  if (!normalizedPatch) {
    return;
  }

  if (hasOpenEditorPaths) {
    store.set(openEditorPathsAtomFamily(workspaceId), normalizedPatch.openEditorPaths ?? []);
  }

  if (hasActiveEditorPath) {
    store.set(activeFilePathAtomFamily(workspaceId), normalizedPatch.activeEditorPath ?? null);
  }
}
