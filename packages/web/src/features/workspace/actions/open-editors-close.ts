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
    openEditorPaths = [],
    activeFilePath,
    pendingActiveFilePath = null,
    targetPath,
    closeAll = false,
  } = input;
  const resolvedOrderedPaths = orderOpenEditorPaths(
    mergeOpenEditorPaths(
      openEditorPaths,
      Object.keys(openFiles),
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

  return {
    orderedPaths: resolvedOrderedPaths,
    removedPaths: [targetPath],
    nextActiveFilePath: null,
    shouldExitEditor: true,
  };
}
