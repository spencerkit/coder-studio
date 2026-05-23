import type { OpenFile } from "../atoms";

export function orderOpenEditorPaths(openFiles: Record<string, OpenFile>): string[] {
  return Object.keys(openFiles).sort((left, right) => left.localeCompare(right));
}

interface ResolveOpenEditorsCloseInput {
  openFiles: Record<string, OpenFile>;
  activeFilePath: string | null;
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
  const { openFiles, activeFilePath, targetPath, closeAll = false } = input;
  const orderedPaths = orderOpenEditorPaths(openFiles);

  if (closeAll) {
    return {
      orderedPaths,
      removedPaths: orderedPaths,
      nextActiveFilePath: null,
      shouldExitEditor: true,
    };
  }

  if (!targetPath || !(targetPath in openFiles)) {
    return {
      orderedPaths,
      removedPaths: [],
      nextActiveFilePath: activeFilePath,
      shouldExitEditor: false,
    };
  }

  if (activeFilePath !== targetPath) {
    return {
      orderedPaths,
      removedPaths: [targetPath],
      nextActiveFilePath: activeFilePath,
      shouldExitEditor: false,
    };
  }

  const closingIndex = orderedPaths.indexOf(targetPath);
  const remainingPaths = orderedPaths.filter((path) => path !== targetPath);

  const nextActiveFilePath =
    remainingPaths[closingIndex] ?? remainingPaths[closingIndex - 1] ?? null;

  return {
    orderedPaths,
    removedPaths: [targetPath],
    nextActiveFilePath,
    shouldExitEditor: nextActiveFilePath === null,
  };
}
