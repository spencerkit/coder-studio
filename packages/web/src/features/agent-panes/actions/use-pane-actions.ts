import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useWorkspaceUiStatePersistence } from "../../workspace/actions/use-workspace-ui-state-persistence";
import type { PaneNode } from "../atoms/pane-layout";
import { paneLayoutAtomFamily } from "../atoms/pane-layout";
import {
  appendSessionToLayout,
  appendSessionToWidestColumn,
  assignSessionToPane,
  closeDraftPaneById,
  closePaneBySessionId,
  insertPaneAtEdge,
  moveSessionToDraftPane,
  removePaneBySessionId,
  replaceSessionInPane,
  splitPaneByPaneId,
  splitPaneBySessionId,
  swapPaneSessionsByPaneId,
} from "../pane-layout-tree";
import type { PaneDropPlacement } from "./pane-drag-types";

export function usePaneActions(workspaceId: string) {
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const store = useStore();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  const applyLayout = useCallback(
    (update: PaneNode | ((current: PaneNode) => PaneNode)) => {
      const current = store.get(paneLayoutAtomFamily(workspaceId));
      const next = typeof update === "function" ? update(current) : update;
      setPaneLayout(next);
      void persistUiState({ paneLayout: next });
      return next;
    },
    [persistUiState, setPaneLayout, store, workspaceId]
  );

  const splitSessionPane = useCallback(
    (sessionId: string, direction: "horizontal" | "vertical") => {
      applyLayout((current) => splitPaneBySessionId(current, sessionId, direction));
    },
    [applyLayout]
  );

  const splitDraftPane = useCallback(
    (paneId: string, direction: "horizontal" | "vertical") => {
      applyLayout((current) => splitPaneByPaneId(current, paneId, direction));
    },
    [applyLayout]
  );

  const closeSessionPane = useCallback(
    (sessionId: string) => {
      applyLayout((current) => closePaneBySessionId(current, sessionId));
    },
    [applyLayout]
  );

  const closeDraftPane = useCallback(
    (paneId: string) => {
      applyLayout((current) => closeDraftPaneById(current, paneId));
    },
    [applyLayout]
  );

  const removeSessionPane = useCallback(
    (sessionId: string) => {
      applyLayout((current) => removePaneBySessionId(current, sessionId));
    },
    [applyLayout]
  );

  const assignSession = useCallback(
    (paneId: string, sessionId: string) => {
      applyLayout((current) => assignSessionToPane(current, paneId, sessionId));
    },
    [applyLayout]
  );

  const replaceWithSession = useCallback(
    (sessionId: string) => {
      applyLayout({
        id: "root",
        type: "leaf",
        sessionId,
      });
    },
    [applyLayout]
  );

  const replaceSession = useCallback(
    (previousSessionId: string, nextSessionId: string) => {
      applyLayout((current) => replaceSessionInPane(current, previousSessionId, nextSessionId));
    },
    [applyLayout]
  );

  const appendSession = useCallback(
    (
      sessionId: string,
      anchorSessionId?: string | null,
      direction: "horizontal" | "vertical" = "horizontal"
    ) => {
      applyLayout((current) =>
        appendSessionToLayout(current, sessionId, anchorSessionId, direction)
      );
    },
    [applyLayout]
  );

  const appendSessionToMobileColumn = useCallback(
    (sessionId: string) => {
      applyLayout((current) => appendSessionToWidestColumn(current, sessionId));
    },
    [applyLayout]
  );

  const swapPaneSessions = useCallback(
    (sourcePaneId: string, targetPaneId: string) => {
      applyLayout((current) => swapPaneSessionsByPaneId(current, sourcePaneId, targetPaneId));
    },
    [applyLayout]
  );

  const moveSessionToDraft = useCallback(
    (sourcePaneId: string, targetPaneId: string) => {
      applyLayout((current) => moveSessionToDraftPane(current, sourcePaneId, targetPaneId));
    },
    [applyLayout]
  );

  const insertSessionPaneAtEdge = useCallback(
    (
      sourcePaneId: string,
      targetPaneId: string,
      placement: Exclude<PaneDropPlacement, "center">
    ) => {
      applyLayout((current) => insertPaneAtEdge(current, sourcePaneId, targetPaneId, placement));
    },
    [applyLayout]
  );

  return {
    appendSession,
    appendSessionToMobileColumn,
    assignSession,
    closeDraftPane,
    closeSessionPane,
    removeSessionPane,
    replaceSession,
    replaceWithSession,
    splitDraftPane,
    splitSessionPane,
    swapPaneSessions,
    moveSessionToDraft,
    insertSessionPaneAtEdge,
  };
}
