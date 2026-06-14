import { type PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { workspaceByIdAtomFamily } from "../../../atoms/workspaces";
import { cancelPendingEditorLoad } from "../../code-editor/actions/pending-editor-loads";
import { monacoModelRegistry } from "../../code-editor/monaco/model-registry";
import { isSystemAgentInstructionsEditorPath } from "../../code-editor/system-agent-instructions-path";
import {
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  editorViewVisibleAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
  type WorkspaceEditorMode,
} from "../atoms";
import { mergeOpenEditorPaths, removeOpenEditorPaths } from "./open-editor-state";
import { resolveOpenEditorsClose } from "./open-editors-close";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

interface UseOpenEditorsActionsOptions {
  activeFilePathAtom?: PrimitiveAtom<string | null>;
  editorModeAtom?: PrimitiveAtom<WorkspaceEditorMode>;
  getActivationHistoryPaths?: () => string[];
  openEditorPathsAtom?: PrimitiveAtom<string[]>;
  persistEditorUiState?: boolean;
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
  const activeFilePathAtom = options?.activeFilePathAtom ?? activeFilePathAtomFamily(workspaceId);
  const editorModeAtom = options?.editorModeAtom ?? editorModeAtomFamily(workspaceId);
  const openEditorPathsAtom =
    options?.openEditorPathsAtom ?? openEditorPathsAtomFamily(workspaceId);
  const isGlobalEditorState =
    options?.activeFilePathAtom === undefined &&
    options?.editorModeAtom === undefined &&
    options?.openEditorPathsAtom === undefined;
  const shouldPersistEditorUiState = options?.persistEditorUiState !== false;
  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtom);
  const [openEditorPaths, setOpenEditorPaths] = useAtom(openEditorPathsAtom);
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId));
  const [diffPreview, setDiffPreview] = useAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setDiffPreviewDismissed = useSetAtom(gitDiffPreviewDismissedAtomFamily(workspaceId));
  const setEditorViewVisible = useSetAtom(editorViewVisibleAtomFamily(workspaceId));
  const [, setEditorMode] = useAtom(editorModeAtom);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  const closePath = useCallback(
    (targetPath?: string) => {
      const transientActiveFilePath =
        activeFilePath && !(activeFilePath in openFiles) ? activeFilePath : null;
      const resolution = resolveOpenEditorsClose({
        openFiles,
        openEditorPaths,
        activationHistoryPaths: options?.getActivationHistoryPaths?.(),
        activeFilePath,
        pendingActiveFilePath: transientActiveFilePath,
        targetPath,
      });

      if (resolution.removedPaths.length === 0) {
        return;
      }

      if (isGlobalEditorState && activeFilePath === targetPath) {
        setEditorViewVisible(true);
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
        if (
          workspaceRootPath &&
          removedFile?.kind === "text" &&
          !isSystemAgentInstructionsEditorPath(path)
        ) {
          monacoModelRegistry.disposeFile(workspaceRootPath, path);
        }
      }

      const nextOpenEditorPaths = removeOpenEditorPaths(
        mergeOpenEditorPaths(
          openEditorPaths,
          transientActiveFilePath ? [transientActiveFilePath] : undefined
        ),
        resolution.removedPaths
      );

      setOpenEditorPaths(nextOpenEditorPaths);
      setActiveFilePath(resolution.nextActiveFilePath);
      if (resolution.nextActiveFilePath !== activeFilePath || resolution.shouldExitEditor) {
        setEditorMode("edit");
      }
      if (shouldPersistEditorUiState) {
        void persistUiState({
          openEditorPaths: nextOpenEditorPaths,
          activeEditorPath: resolution.nextActiveFilePath,
        });
      }

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
      isGlobalEditorState,
      openEditorPaths,
      openFiles,
      options?.getActivationHistoryPaths,
      setActiveFilePath,
      setDiffPreview,
      setDiffPreviewDismissed,
      setEditorViewVisible,
      setEditorMode,
      setOpenEditorPaths,
      setOpenFiles,
      persistUiState,
      shouldPersistEditorUiState,
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

    if (resolution.removedPaths.length === 0 && activeFilePath === null) {
      return;
    }

    if (isGlobalEditorState) {
      setEditorViewVisible(false);
    }

    for (const path of resolution.removedPaths) {
      cancelPendingEditorLoad(workspaceId, path);
    }
    setOpenFiles((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const path of resolution.removedPaths) {
        if (path in next) {
          delete next[path];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOpenEditorPaths([]);

    for (const path of resolution.removedPaths) {
      const removedFile = openFiles[path];
      if (
        workspaceRootPath &&
        removedFile?.kind === "text" &&
        !isSystemAgentInstructionsEditorPath(path)
      ) {
        monacoModelRegistry.disposeFile(workspaceRootPath, path);
      }
    }

    setActiveFilePath(null);
    setEditorMode("edit");
    if (shouldPersistEditorUiState) {
      void persistUiState({
        openEditorPaths: [],
        activeEditorPath: null,
      });
    }
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
  }, [
    activeFilePath,
    diffPreview,
    isGlobalEditorState,
    openEditorPaths,
    openFiles,
    setActiveFilePath,
    setDiffPreview,
    setDiffPreviewDismissed,
    setEditorViewVisible,
    setEditorMode,
    setOpenEditorPaths,
    setOpenFiles,
    persistUiState,
    shouldPersistEditorUiState,
    workspaceId,
    workspaceRootPath,
  ]);

  return { closeAll, closePath };
}
