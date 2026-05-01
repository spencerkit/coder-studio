import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { paneLayoutAtomFamily } from '../atoms/pane-layout';
import {
  assignSessionToPane,
  closeDraftPaneById,
  closePaneBySessionId,
  splitPaneByPaneId,
  splitPaneBySessionId,
} from '../pane-layout-tree';

export function usePaneActions(workspaceId: string) {
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));

  const splitSessionPane = useCallback(
    (sessionId: string, direction: 'horizontal' | 'vertical') => {
      setPaneLayout((current) => splitPaneBySessionId(current, sessionId, direction));
    },
    [setPaneLayout]
  );

  const splitDraftPane = useCallback(
    (paneId: string, direction: 'horizontal' | 'vertical') => {
      setPaneLayout((current) => splitPaneByPaneId(current, paneId, direction));
    },
    [setPaneLayout]
  );

  const closeSessionPane = useCallback(
    (sessionId: string) => {
      setPaneLayout((current) => closePaneBySessionId(current, sessionId));
    },
    [setPaneLayout]
  );

  const closeDraftPane = useCallback(
    (paneId: string) => {
      setPaneLayout((current) => closeDraftPaneById(current, paneId));
    },
    [setPaneLayout]
  );

  const assignSession = useCallback(
    (paneId: string, sessionId: string) => {
      setPaneLayout((current) => assignSessionToPane(current, paneId, sessionId));
    },
    [setPaneLayout]
  );

  const replaceWithSession = useCallback(
    (sessionId: string) => {
      setPaneLayout({
        id: 'root',
        type: 'leaf',
        sessionId,
      });
    },
    [setPaneLayout]
  );

  return {
    assignSession,
    closeDraftPane,
    closeSessionPane,
    replaceWithSession,
    splitDraftPane,
    splitSessionPane,
  };
}
