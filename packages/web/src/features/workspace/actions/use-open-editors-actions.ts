import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  gitDiffPreviewDismissedAtomFamily,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import { mergeOpenEditorPaths, removeOpenEditorPaths } from "./open-editor-state";
import { resolveOpenEditorsClose } from "./open-editors-close";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

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

  if (preview.kind === "commit-file-list" || preview.kind === "commit-file-diff") {
    return false;
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
  const [openEditorPaths, setOpenEditorPaths] = useAtom(openEditorPathsAtomFamily(workspaceId));
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId));
  const [diffPreview, setDiffPreview] = useAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setDiffPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));
  const [, setEditorMode] = useAtom(editorModeAtomFamily(workspaceId));
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  const closePath = useCallback(
    (targetPath?: string) => {
      const transientActiveFilePath =
        activeFilePath && !(activeFilePath in openFiles) ? activeFilePath : null;
      const resolution = resolveOpenEditorsClose({
        openFiles,
        openEditorPaths,
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

      const nextOpenEditorPaths = removeOpenEditorPaths(
        mergeOpenEditorPaths(
          openEditorPaths,
          Object.keys(openFiles),
          transientActiveFilePath ? [transientActiveFilePath] : undefined
        ),
        resolution.removedPaths
      );

      setOpenEditorPaths(nextOpenEditorPaths);
      setActiveFilePath(resolution.nextActiveFilePath);
      if (resolution.nextActiveFilePath !== activeFilePath || resolution.shouldExitEditor) {
        setEditorMode("edit");
      }
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        activeEditorPath: resolution.nextActiveFilePath,
      });

      const shouldDismissPreview =
        (diffPreview?.kind === "worktree-file-diff" ||
          diffPreview?.kind === "search-replace-file-diff") &&
        shouldClearDiffPreview(diffPreview, resolution.removedPaths, resolution.shouldExitEditor);
      if (shouldDismissPreview) {
        setDiffPreviewDismissed(true);
      }

      setDiffPreview((current) =>
        shouldClearDiffPreview(current, resolution.removedPaths, resolution.shouldExitEditor)
          ? null
          : current
      );
    },
    [
      activeFilePath,
      diffPreview,
      openEditorPaths,
      openFiles,
      setActiveFilePath,
      setDiffPreview,
      setDiffPreviewDismissed,
      setEditorMode,
      setOpenEditorPaths,
      setOpenFiles,
      persistUiState,
      workspaceId,
      workspaceRootPath,
    ]
  );

  const closeAll = useCallback(() => {
    const transientActiveFilePath =
      activeFilePath && !(activeFilePath in openFiles) ? activeFilePath : null;
    const resolution = resolveOpenEditorsClose({
      openFiles,
      openEditorPaths,
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
    setOpenEditorPaths([]);

    for (const path of resolution.removedPaths) {
      const removedFile = openFiles[path];
      if (workspaceRootPath && removedFile?.kind === "text") {
        monacoModelRegistry.disposeFile(workspaceRootPath, path);
      }
    }

    setActiveFilePath(null);
    setEditorMode("edit");
    void persistUiState({
      openEditorPaths: [],
      activeEditorPath: null,
    });
    const shouldDismissPreview =
      (diffPreview?.kind === "worktree-file-diff" ||
        diffPreview?.kind === "search-replace-file-diff") &&
      shouldClearDiffPreview(diffPreview, resolution.removedPaths, resolution.shouldExitEditor, {
        preserveCommitPreviewOnExit: true,
      });
    if (shouldDismissPreview) {
      setDiffPreviewDismissed(true);
    }
    setDiffPreview((current) =>
      shouldClearDiffPreview(current, resolution.removedPaths, resolution.shouldExitEditor, {
        preserveCommitPreviewOnExit: true,
      })
        ? null
        : current
    );
  }, [
    activeFilePath,
    diffPreview,
    openEditorPaths,
    openFiles,
    setActiveFilePath,
    setDiffPreview,
    setDiffPreviewDismissed,
    setEditorMode,
    setOpenEditorPaths,
    setOpenFiles,
    persistUiState,
    workspaceId,
    workspaceRootPath,
  ]);

  return { closeAll, closePath };
}
