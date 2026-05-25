import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { usePaneActions } from "../../agent-panes/actions/use-pane-actions";
import {
  activeEditorPaneIdAtomFamily,
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
import { deriveEditorModeForPath, editorModeAtomFamily } from "../atoms";

interface OpenWorkspaceFileOptions {
  targetDraftPaneId?: string;
}

export function useOpenWorkspaceFile(workspaceId: string) {
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const activeEditorPaneId = useAtomValue(activeEditorPaneIdAtomFamily(workspaceId));
  const focusedEditorPaneId = useAtomValue(focusedEditorPaneIdAtomFamily(workspaceId));
  const setActiveEditorPaneId = useSetAtom(activeEditorPaneIdAtomFamily(workspaceId));
  const setFocusedEditorPaneId = useSetAtom(focusedEditorPaneIdAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const { convertDraftPane } = usePaneActions(workspaceId);

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

        setFocusedEditorPaneId(targetEditorPaneId);
      } else if (
        focusedEditorPaneId &&
        paneLayoutHasEditorPaneId(paneLayout, focusedEditorPaneId)
      ) {
        targetEditorPaneId = focusedEditorPaneId;
      } else if (activeEditorPaneId && paneLayoutHasEditorPaneId(paneLayout, activeEditorPaneId)) {
        targetEditorPaneId = activeEditorPaneId;
      }

      setActiveEditorPaneId(targetEditorPaneId);
      setEditorMode(deriveEditorModeForPath(input.path));
      await openLocation(input);
    },
    [
      activeEditorPaneId,
      convertDraftPane,
      focusedEditorPaneId,
      openLocation,
      paneLayout,
      setActiveEditorPaneId,
      setEditorMode,
      setFocusedEditorPaneId,
    ]
  );

  return { openWorkspaceFile };
}
