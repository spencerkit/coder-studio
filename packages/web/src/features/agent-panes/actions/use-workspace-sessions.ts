import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import type { Session, Workspace } from '@coder-studio/core';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { connectionStatusAtom, dispatchCommandAtom } from '../../../atoms/connection';
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';
import { useWorkspaceUiStatePersistence } from '../../workspace/actions/use-workspace-ui-state-persistence';
import {
  clearLegacyPaneLayout,
  defaultPaneLayout,
  paneLayoutAtomFamily,
  readLegacyPaneLayout,
  type PaneNode,
} from '../atoms/pane-layout';
import { collectSessionIds, createFallbackPaneLayout, sanitizePaneLayout } from '../pane-layout-tree';

interface UseWorkspaceSessionsOptions {
  disabled?: boolean;
}

export function useWorkspaceSessions(
  workspaceOverride?: Workspace | null,
  options?: UseWorkspaceSessionsOptions
) {
  const workspaceFromAtom = useAtomValue(activeWorkspaceAtom);
  const workspace = workspaceOverride === undefined ? workspaceFromAtom : workspaceOverride;
  const workspaceId = workspace?.id ?? '__workspace_empty__';
  const disabled = options?.disabled ?? false;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const store = useStore();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  useEffect(() => {
    if (disabled) {
      return;
    }

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
        const workspacePaneLayout = normalizePaneLayout(workspace?.uiState.paneLayout);
        const legacyPaneLayout = workspacePaneLayout ? null : readLegacyPaneLayout(workspace.id);
        const baseLayout = workspacePaneLayout ?? legacyPaneLayout ?? currentLayout ?? defaultPaneLayout;
        const displayableSessionIds = new Set(
          nextSessions
            .filter((session) => session.state !== 'draft')
            .map((session) => session.id)
        );

        const displayableSessions = nextSessions.filter((session) => session.state !== 'draft');
        const sanitized = sanitizePaneLayout(baseLayout, displayableSessionIds);
        let nextLayout = sanitized;
        if (sanitized !== currentLayout) {
          setPaneLayout(sanitized);
        }

        const hasAnySessionInLayout = collectSessionIds(sanitized).length > 0;
        if (!hasAnySessionInLayout) {
          if (displayableSessions.length > 0) {
            nextLayout = createFallbackPaneLayout(displayableSessions.map((session) => session.id));
            setPaneLayout(nextLayout);
          }
        }

        if (!workspacePaneLayout) {
          const shouldPersistLayout =
            legacyPaneLayout !== null || collectSessionIds(nextLayout).length > 0;
          if (shouldPersistLayout) {
            void persistUiState({ paneLayout: nextLayout }).then((persisted) => {
              if (persisted && legacyPaneLayout !== null) {
                clearLegacyPaneLayout(workspace.id);
              }
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
  }, [
    connectionStatus,
    disabled,
    dispatch,
    persistUiState,
    setPaneLayout,
    setSessions,
    store,
    workspace?.id,
    workspaceId,
  ]);

  return {
    workspace,
    workspaceId,
    sessions,
    paneLayout,
    setPaneLayout,
  };
}

function normalizePaneLayout(layout: Workspace['uiState']['paneLayout']): PaneNode | null {
  if (!layout) {
    return null;
  }

  return {
    ...layout,
    children: layout.children?.map((child) => normalizePaneLayout(child) ?? defaultPaneLayout),
  };
}
