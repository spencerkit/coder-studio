import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { workspaceByIdAtomFamily } from "../../../atoms/workspaces";
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
  shouldExitEditor: boolean
): boolean {
  if (!preview) {
    return false;
  }

  if (shouldExitEditor) {
    return true;
  }

  return preview.source === "file" && removedPaths.includes(preview.path);
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
      const resolution = resolveOpenEditorsClose({
        openFiles,
        activeFilePath,
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
      workspaceRootPath,
    ]
  );

  const closeAll = useCallback(() => {
    const resolution = resolveOpenEditorsClose({
      openFiles,
      activeFilePath,
      closeAll: true,
    });

    if (resolution.removedPaths.length === 0) {
      return;
    }

    setOpenFiles({});

    for (const path of resolution.removedPaths) {
      const removedFile = openFiles[path];
      if (workspaceRootPath && removedFile?.kind === "text") {
        monacoModelRegistry.disposeFile(workspaceRootPath, path);
      }
    }

    setActiveFilePath(null);
    setEditorMode("edit");
    setDiffPreview(null);
  }, [
    activeFilePath,
    openFiles,
    setActiveFilePath,
    setDiffPreview,
    setEditorMode,
    setOpenFiles,
    workspaceRootPath,
  ]);

  return { closeAll, closePath };
}
