import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import type { Session, Workspace } from '@coder-studio/core';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { connectionStatusAtom, dispatchCommandAtom } from '../../../atoms/connection';
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';
import { paneLayoutAtomFamily } from '../atoms/pane-layout';
import { collectSessionIds, sanitizePaneLayout } from '../pane-layout-tree';

export function useWorkspaceSessions(workspaceOverride?: Workspace | null) {
  const workspaceFromAtom = useAtomValue(activeWorkspaceAtom);
  const workspace = workspaceOverride === undefined ? workspaceFromAtom : workspaceOverride;
  const workspaceId = workspace?.id ?? '__workspace_empty__';
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const store = useStore();

  useEffect(() => {
    if (!workspace) {
      return;
    }

    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    dispatch<Session[]>('session.list', { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          console.error('Failed to fetch sessions:', result.error?.message);
          return;
        }

        const nextSessions = result.data;

        setSessions((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([, session]) => session.workspaceId !== workspace.id)
          );

          for (const session of nextSessions) {
            next[session.id] = session;
          }

          return next;
        });

        const currentLayout = store.get(paneLayoutAtomFamily(workspaceId));
        const liveSessionIds = new Set(
          nextSessions
            .filter((session) => session.state !== 'ended')
            .map((session) => session.id)
        );

        const sanitized = sanitizePaneLayout(currentLayout, liveSessionIds);
        if (sanitized !== currentLayout) {
          setPaneLayout(sanitized);
          return;
        }

        const hasAnySessionInLayout = collectSessionIds(currentLayout).length > 0;
        if (!hasAnySessionInLayout) {
          const liveSessions = nextSessions.filter((session) => session.state !== 'ended');
          if (liveSessions.length > 0) {
            setPaneLayout({
              id: 'root',
              type: 'leaf',
              sessionId: liveSessions[0]!.id,
            });
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch sessions:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, workspaceId, connectionStatus, dispatch, setSessions, setPaneLayout, store]);

  return {
    workspace,
    workspaceId,
    sessions,
    paneLayout,
    setPaneLayout,
  };
}
