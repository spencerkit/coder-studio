import type { OpenFile } from "../atoms";

export function orderOpenEditorPaths(openFiles: Record<string, OpenFile>): string[] {
  return Object.keys(openFiles).sort((left, right) => left.localeCompare(right));
}

interface ResolveOpenEditorsCloseInput {
  openFiles: Record<string, OpenFile>;
  activeFilePath: string | null;
  pathToClose?: string;
  closeAll?: boolean;
}

interface ResolveOpenEditorsCloseResult {
  openFiles: Record<string, OpenFile>;
  activeFilePath: string | null;
  shouldExitEditor: boolean;
}

export function resolveOpenEditorsClose(
  input: ResolveOpenEditorsCloseInput
): ResolveOpenEditorsCloseResult {
  const { openFiles, activeFilePath, pathToClose, closeAll = false } = input;

  if (closeAll) {
    return {
      openFiles: {},
      activeFilePath: null,
      shouldExitEditor: true,
    };
  }

  if (!pathToClose || !(pathToClose in openFiles)) {
    return {
      openFiles,
      activeFilePath,
      shouldExitEditor: false,
    };
  }

  const orderedPaths = orderOpenEditorPaths(openFiles);
  const closingIndex = orderedPaths.indexOf(pathToClose);
  const nextOpenFiles = { ...openFiles };
  delete nextOpenFiles[pathToClose];

  if (activeFilePath !== pathToClose) {
    return {
      openFiles: nextOpenFiles,
      activeFilePath,
      shouldExitEditor: false,
    };
  }

  const remainingPaths = orderOpenEditorPaths(nextOpenFiles);
  const nextActiveFilePath =
    remainingPaths[closingIndex] ?? remainingPaths[closingIndex - 1] ?? null;

  return {
    openFiles: nextOpenFiles,
    activeFilePath: nextActiveFilePath,
    shouldExitEditor: nextActiveFilePath === null,
  };
}
