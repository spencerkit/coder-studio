import { useCallback } from 'react';
import { useSetAtom, useStore } from 'jotai';
import { paneLayoutAtomFamily } from '../atoms/pane-layout';
import {
  appendSessionToLayout,
  assignSessionToPane,
  closeDraftPaneById,
  closePaneBySessionId,
  splitPaneByPaneId,
  splitPaneBySessionId,
} from '../pane-layout-tree';
import { useWorkspaceUiStatePersistence } from '../../workspace/actions/use-workspace-ui-state-persistence';
import type { PaneNode } from '../atoms/pane-layout';

export function usePaneActions(workspaceId: string) {
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const store = useStore();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  const applyLayout = useCallback(
    (update: PaneNode | ((current: PaneNode) => PaneNode)) => {
      const current = store.get(paneLayoutAtomFamily(workspaceId));
      const next = typeof update === 'function' ? update(current) : update;
      setPaneLayout(next);
      void persistUiState({ paneLayout: next });
      return next;
    },
    [persistUiState, setPaneLayout, store, workspaceId]
  );

  const splitSessionPane = useCallback(
    (sessionId: string, direction: 'horizontal' | 'vertical') => {
      applyLayout((current) => splitPaneBySessionId(current, sessionId, direction));
    },
    [applyLayout]
  );

  const splitDraftPane = useCallback(
    (paneId: string, direction: 'horizontal' | 'vertical') => {
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

  const assignSession = useCallback(
    (paneId: string, sessionId: string) => {
      applyLayout((current) => assignSessionToPane(current, paneId, sessionId));
    },
    [applyLayout]
  );

  const replaceWithSession = useCallback(
    (sessionId: string) => {
      applyLayout({
        id: 'root',
        type: 'leaf',
        sessionId,
      });
    },
    [applyLayout]
  );

  const appendSession = useCallback(
    (
      sessionId: string,
      anchorSessionId?: string | null,
      direction: 'horizontal' | 'vertical' = 'horizontal'
    ) => {
      applyLayout((current) => appendSessionToLayout(current, sessionId, anchorSessionId, direction));
    },
    [applyLayout]
  );

  return {
    appendSession,
    assignSession,
    closeDraftPane,
    closeSessionPane,
    replaceWithSession,
    splitDraftPane,
    splitSessionPane,
  };
}
