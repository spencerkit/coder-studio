import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import { activeFilePathAtomFamily, openFilesAtomFamily } from "../../workspace/atoms";
import { type PendingEditorNavigation, pendingEditorNavigationAtomFamily } from "../atoms";

export function useOpenLocation(workspaceId: string): {
  openLocation(input: PendingEditorNavigation): Promise<void>;
  clearPendingNavigation(path: string): void;
} {
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setPendingNavigation = useSetAtom(pendingEditorNavigationAtomFamily(workspaceId));
  const nextRequestIdRef = useRef(0);

  const openLocation = useCallback(
    async (input: PendingEditorNavigation) => {
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
    [openFiles, setActiveFilePath, setPendingNavigation]
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
