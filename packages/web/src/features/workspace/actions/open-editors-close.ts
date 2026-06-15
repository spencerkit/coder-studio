import type { OpenFile } from "../atoms";
import { mergeOpenEditorPaths, normalizeOpenEditorPaths } from "./open-editor-state";

function isPathIterable(
  source: Record<string, OpenFile> | Iterable<string>
): source is Iterable<string> {
  return typeof (source as Iterable<string>)[Symbol.iterator] === "function";
}

export function orderOpenEditorPaths(
  source: Record<string, OpenFile> | Iterable<string>
): string[] {
  const paths = isPathIterable(source) ? Array.from(source) : Object.keys(source);
  return normalizeOpenEditorPaths(paths).sort();
}

interface ResolveOpenEditorsCloseInput {
  openFiles: Record<string, OpenFile>;
  openEditorPaths?: string[];
  activationHistoryPaths?: string[];
  activeFilePath: string | null;
  pendingActiveFilePath?: string | null;
  targetPath?: string;
  closeAll?: boolean;
}

interface ResolveOpenEditorsCloseResult {
  orderedPaths: string[];
  removedPaths: string[];
  nextActiveFilePath: string | null;
  shouldExitEditor: boolean;
}

export function resolveOpenEditorsClose(
  input: ResolveOpenEditorsCloseInput
): ResolveOpenEditorsCloseResult {
  const {
    openEditorPaths = [],
    activationHistoryPaths = [],
    activeFilePath,
    pendingActiveFilePath = null,
    targetPath,
    closeAll = false,
  } = input;
  const resolvedOrderedPaths = orderOpenEditorPaths(
    mergeOpenEditorPaths(
      openEditorPaths,
      activeFilePath ? [activeFilePath] : undefined,
      pendingActiveFilePath ? [pendingActiveFilePath] : undefined
    )
  );

  if (closeAll) {
    return {
      orderedPaths: resolvedOrderedPaths,
      removedPaths: resolvedOrderedPaths,
      nextActiveFilePath: null,
      shouldExitEditor: true,
    };
  }

  if (!targetPath || !resolvedOrderedPaths.includes(targetPath)) {
    return {
      orderedPaths: resolvedOrderedPaths,
      removedPaths: [],
      nextActiveFilePath: activeFilePath,
      shouldExitEditor: false,
    };
  }

  if (activeFilePath !== targetPath) {
    return {
      orderedPaths: resolvedOrderedPaths,
      removedPaths: [targetPath],
      nextActiveFilePath: activeFilePath,
      shouldExitEditor: false,
    };
  }

  const remainingPaths = resolvedOrderedPaths.filter((path) => path !== targetPath);
  const remainingPathSet = new Set(remainingPaths);
  const activationHistoryCandidates = normalizeOpenEditorPaths(activationHistoryPaths).filter(
    (path) => path !== targetPath && remainingPathSet.has(path)
  );
  const nextActiveFromHistory = activationHistoryCandidates[activationHistoryCandidates.length - 1];
  const targetIndex = resolvedOrderedPaths.indexOf(targetPath);
  const nextActiveFilePath =
    nextActiveFromHistory ??
    remainingPaths[Math.max(0, targetIndex - 1)] ??
    remainingPaths[targetIndex] ??
    null;

  return {
    orderedPaths: resolvedOrderedPaths,
    removedPaths: [targetPath],
    nextActiveFilePath,
    shouldExitEditor: false,
  };
}
