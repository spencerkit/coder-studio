import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { workspaceByIdAtomFamily } from "../../../atoms/workspaces";
import {
  cancelAllPendingEditorLoads,
  cancelPendingEditorLoad,
  hasAnyPendingEditorLoads,
} from "../../code-editor/actions/pending-editor-loads";
import { monacoModelRegistry } from "../../code-editor/monaco/model-registry";
import {
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import { resolveOpenEditorsClose } from "./open-editors-close";

interface UseOpenEditorsActionsOptions {
  workspaceRootPath?: string;
}

function shouldClearDiffPreview(
  preview: GitDiffPreview | null,
  removedPaths: string[],
  shouldExitEditor: boolean,
  options?: { preserveCommitPreviewOnExit?: boolean }
): boolean {
  if (!preview) {
    return false;
  }

  if (preview.source === "commit") {
    return shouldExitEditor && !options?.preserveCommitPreviewOnExit;
  }

  if (shouldExitEditor) {
    return true;
  }

  return removedPaths.includes(preview.path);
}

export function useOpenEditorsActions(workspaceId: string, options?: UseOpenEditorsActionsOptions) {
  const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
  const workspaceRootPath = options?.workspaceRootPath ?? workspace?.path;
  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtomFamily(workspaceId));
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId));
  const [, setDiffPreview] = useAtom(gitDiffPreviewAtomFamily(workspaceId));
  const [, setEditorMode] = useAtom(editorModeAtomFamily(workspaceId));

  const closePath = useCallback(
    (targetPath?: string) => {
      const transientActiveFilePath =
        activeFilePath && !(activeFilePath in openFiles) ? activeFilePath : null;
      const resolution = resolveOpenEditorsClose({
        openFiles,
        activeFilePath,
        pendingActiveFilePath: transientActiveFilePath,
        targetPath,
      });

      if (resolution.removedPaths.length === 0) {
        return;
      }

      setOpenFiles((prev) => {
        const next = { ...prev };
        for (const path of resolution.removedPaths) {
          delete next[path];
        }
        return next;
      });

      for (const path of resolution.removedPaths) {
        if (!(path in openFiles)) {
          cancelPendingEditorLoad(workspaceId, path);
          continue;
        }

        const removedFile = openFiles[path];
        if (workspaceRootPath && removedFile?.kind === "text") {
          monacoModelRegistry.disposeFile(workspaceRootPath, path);
        }
      }

      setActiveFilePath(resolution.nextActiveFilePath);
      if (resolution.nextActiveFilePath !== activeFilePath || resolution.shouldExitEditor) {
        setEditorMode("edit");
      }

      setDiffPreview((current) =>
        shouldClearDiffPreview(current, resolution.removedPaths, resolution.shouldExitEditor)
          ? null
          : current
      );
    },
    [
      activeFilePath,
      openFiles,
      setActiveFilePath,
      setDiffPreview,
      setEditorMode,
      setOpenFiles,
      workspaceId,
      workspaceRootPath,
    ]
  );

  const closeAll = useCallback(() => {
    const transientActiveFilePath =
      activeFilePath && !(activeFilePath in openFiles) ? activeFilePath : null;
    const resolution = resolveOpenEditorsClose({
      openFiles,
      activeFilePath,
      pendingActiveFilePath: transientActiveFilePath,
      closeAll: true,
    });

    if (
      resolution.removedPaths.length === 0 &&
      activeFilePath === null &&
      !hasAnyPendingEditorLoads(workspaceId)
    ) {
      return;
    }

    cancelAllPendingEditorLoads(workspaceId);
    setOpenFiles({});

    for (const path of resolution.removedPaths) {
      const removedFile = openFiles[path];
      if (workspaceRootPath && removedFile?.kind === "text") {
        monacoModelRegistry.disposeFile(workspaceRootPath, path);
      }
    }

    setActiveFilePath(null);
    setEditorMode("edit");
    setDiffPreview((current) =>
      shouldClearDiffPreview(current, resolution.removedPaths, resolution.shouldExitEditor, {
        preserveCommitPreviewOnExit: true,
      })
        ? null
        : current
    );
  }, [
    activeFilePath,
    openFiles,
    setActiveFilePath,
    setDiffPreview,
    setEditorMode,
    setOpenFiles,
    workspaceId,
    workspaceRootPath,
  ]);

  return { closeAll, closePath };
}
