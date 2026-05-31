import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import {
  activeFilePathAtomFamily,
  deriveEditorModeForOpenFile,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  gitDiffPreviewAtomFamily,
  openFilesAtomFamily,
} from "../../workspace/atoms";
import { type PendingEditorNavigation, pendingEditorNavigationAtomFamily } from "../atoms";

export function useOpenLocation(workspaceId: string): {
  openLocation(input: PendingEditorNavigation): Promise<void>;
  clearPendingNavigation(path: string): void;
} {
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setPendingNavigation = useSetAtom(pendingEditorNavigationAtomFamily(workspaceId));
  const nextRequestIdRef = useRef(0);

  const openLocation = useCallback(
    async (input: PendingEditorNavigation) => {
      if (
        diffPreview?.kind === "commit-file-list" ||
        diffPreview?.kind === "commit-file-diff" ||
        diffPreview?.kind === "search-replace-file-diff"
      ) {
        setDiffPreview(null);
        const openFile = openFiles[input.path];
        setEditorMode(
          openFile ? deriveEditorModeForOpenFile(openFile) : deriveEditorModeForPath(input.path)
        );
      }

      setActiveFilePath(input.path);

      if (!openFiles[input.path]) {
        // Existing editor load flow is keyed off activeFilePath. Setting it is
        // enough to trigger file.read in useCodeEditorActions.
      }

      setPendingNavigation({
        ...input,
        requestId: ++nextRequestIdRef.current,
      });
    },
    [diffPreview, openFiles, setActiveFilePath, setDiffPreview, setEditorMode, setPendingNavigation]
  );

  const clearPendingNavigation = useCallback(
    (path: string) => {
      setPendingNavigation((current) => (current?.path === path ? null : current));
    },
    [setPendingNavigation]
  );

  return {
    openLocation,
    clearPendingNavigation,
  };
}
