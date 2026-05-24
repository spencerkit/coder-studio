import type { OpenFile } from "../atoms";

export function orderOpenEditorPaths(openFiles: Record<string, OpenFile>): string[] {
  return Object.keys(openFiles).sort();
}

interface ResolveOpenEditorsCloseInput {
  openFiles: Record<string, OpenFile>;
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
    openFiles,
    activeFilePath,
    pendingActiveFilePath = null,
    targetPath,
    closeAll = false,
  } = input;
  const orderedPaths = orderOpenEditorPaths(openFiles);
  const resolvedOrderedPaths =
    pendingActiveFilePath && !orderedPaths.includes(pendingActiveFilePath)
      ? [...orderedPaths, pendingActiveFilePath].sort()
      : orderedPaths;

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

  return {
    orderedPaths: resolvedOrderedPaths,
    removedPaths: [targetPath],
    nextActiveFilePath: null,
    shouldExitEditor: true,
  };
}
