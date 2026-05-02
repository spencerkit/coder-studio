import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import type { Session, Workspace } from '@coder-studio/core';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { connectionStatusAtom, dispatchCommandAtom } from '../../../atoms/connection';
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';
import { useWorkspaceUiStatePersistence } from '../../workspace/actions/use-workspace-ui-state-persistence';
import {
  LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX,
  defaultPaneLayout,
  paneLayoutAtomFamily,
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
        const liveSessionIds = new Set(
          nextSessions
            .filter((session) => session.state !== 'ended')
            .map((session) => session.id)
        );

        const liveSessions = nextSessions.filter((session) => session.state !== 'ended');
        const sanitized = sanitizePaneLayout(baseLayout, liveSessionIds);
        let nextLayout = sanitized;
        if (sanitized !== currentLayout) {
          setPaneLayout(sanitized);
        }

        const hasAnySessionInLayout = collectSessionIds(sanitized).length > 0;
        if (!hasAnySessionInLayout) {
          if (liveSessions.length > 0) {
            nextLayout = createFallbackPaneLayout(liveSessions.map((session) => session.id));
            setPaneLayout(nextLayout);
          }
        }

        if (!workspacePaneLayout) {
          const shouldPersistLayout =
            legacyPaneLayout !== null || collectSessionIds(nextLayout).length > 0;
          if (shouldPersistLayout) {
            void persistUiState({ paneLayout: nextLayout });
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

function readLegacyPaneLayout(workspaceId: string): PaneNode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(`${LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX}${workspaceId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PaneNode;
  } catch {
    return null;
  }
}
