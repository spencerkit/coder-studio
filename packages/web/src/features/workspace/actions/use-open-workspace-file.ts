import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { usePaneActions } from "../../agent-panes/actions/use-pane-actions";
import {
  activeEditorPaneIdAtomFamily,
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPanePendingNavigationAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  findEditorPaneId,
  paneLayoutHasDraftPaneId,
  paneLayoutHasEditorPaneId,
} from "../../agent-panes/pane-layout-tree";
import { useOpenLocation } from "../../code-editor/actions/use-open-location";
import { type PendingEditorNavigation } from "../../code-editor/atoms";
import { deriveEditorModeForPath, editorModeAtomFamily, openEditorPathsAtomFamily } from "../atoms";
import { appendOpenEditorPath } from "./open-editor-state";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

interface OpenWorkspaceFileOptions {
  targetDraftPaneId?: string;
}

export function useOpenWorkspaceFile(workspaceId: string) {
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const activeEditorPaneId = useAtomValue(activeEditorPaneIdAtomFamily(workspaceId));
  const setActiveEditorPaneId = useSetAtom(activeEditorPaneIdAtomFamily(workspaceId));
  const setEditorPaneActiveFilePath = useSetAtom(editorPaneActiveFilePathAtomFamily(workspaceId));
  const setEditorPaneMode = useSetAtom(editorPaneModeAtomFamily(workspaceId));
  const setEditorPanePendingNavigation = useSetAtom(
    editorPanePendingNavigationAtomFamily(workspaceId)
  );
  const setFocusedEditorPaneId = useSetAtom(focusedEditorPaneIdAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const setOpenEditorPaths = useSetAtom(openEditorPathsAtomFamily(workspaceId));
  const store = useStore();
  const { openLocation } = useOpenLocation(workspaceId);
  const { convertDraftPane } = usePaneActions(workspaceId);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const nextEditorPaneRequestIdRef = useRef(0);

  const openWorkspaceFile = useCallback(
    async (input: PendingEditorNavigation, options: OpenWorkspaceFileOptions = {}) => {
      let targetEditorPaneId: string | null = null;

      if (options.targetDraftPaneId) {
        const existingEditorPaneId = findEditorPaneId(paneLayout);
        if (existingEditorPaneId) {
          targetEditorPaneId = existingEditorPaneId;
        } else if (paneLayoutHasDraftPaneId(paneLayout, options.targetDraftPaneId)) {
          convertDraftPane(options.targetDraftPaneId);
          targetEditorPaneId = options.targetDraftPaneId;
        }

        if (targetEditorPaneId) {
          setFocusedEditorPaneId(targetEditorPaneId);
          setActiveEditorPaneId(targetEditorPaneId);
          setEditorPaneMode(deriveEditorModeForPath(input.path));
          setEditorPaneActiveFilePath(input.path);
          setEditorPanePendingNavigation({
            ...input,
            requestId: ++nextEditorPaneRequestIdRef.current,
          });
          return;
        }
      }

      setFocusedEditorPaneId(null);
      if (activeEditorPaneId && !paneLayoutHasEditorPaneId(paneLayout, activeEditorPaneId)) {
        setActiveEditorPaneId(null);
      }

      setEditorMode(deriveEditorModeForPath(input.path));
      await openLocation(input);
      const nextOpenEditorPaths = appendOpenEditorPath(
        store.get(openEditorPathsAtomFamily(workspaceId)),
        input.path
      );
      setOpenEditorPaths(nextOpenEditorPaths);
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        activeEditorPath: input.path,
      });
    },
    [
      activeEditorPaneId,
      convertDraftPane,
      openLocation,
      paneLayout,
      persistUiState,
      setActiveEditorPaneId,
      setEditorPaneActiveFilePath,
      setEditorPaneMode,
      setEditorPanePendingNavigation,
      setEditorMode,
      setFocusedEditorPaneId,
      setOpenEditorPaths,
      store,
      workspaceId,
    ]
  );

  return { openWorkspaceFile };
}
