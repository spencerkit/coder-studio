import type { Session, Workspace } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { activationStatusAtom } from "../../../atoms/activation";
import { connectionStatusAtom, dispatchCommandAtom } from "../../../atoms/connection";
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from "../../../atoms/sessions";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import { useWorkspaceUiStatePersistence } from "../../workspace/actions/use-workspace-ui-state-persistence";
import {
  clearLegacyPaneLayout,
  defaultPaneLayout,
  type PaneNode,
  paneLayoutAtomFamily,
  readLegacyPaneLayout,
} from "../atoms/pane-layout";
import {
  appendSessionToLayout,
  collectSessionIds,
  createFallbackPaneLayout,
  sanitizePaneLayout,
} from "../pane-layout-tree";

interface UseWorkspaceSessionsOptions {
  disabled?: boolean;
}

export function useWorkspaceSessions(
  workspaceOverride?: Workspace | null,
  options?: UseWorkspaceSessionsOptions
) {
  const workspaceFromAtom = useAtomValue(activeWorkspaceAtom);
  const workspace = workspaceOverride === undefined ? workspaceFromAtom : workspaceOverride;
  const workspaceId = workspace?.id ?? "__workspace_empty__";
  const disabled = options?.disabled ?? false;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const activationStatus = useAtomValue(activationStatusAtom);
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

    if (connectionStatus !== "connected" || activationStatus !== "active") {
      return;
    }

    let cancelled = false;
    const workspaceSessionIdsAtRequestStart = new Set(
      Object.values(store.get(sessionsAtom))
        .filter((session) => session.workspaceId === workspace.id)
        .map((session) => session.id)
    );

    dispatch<Session[]>("session.list", { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          console.error("Failed to fetch sessions:", result.error?.message);
          return;
        }

        const nextSessions = result.data;
        const currentWorkspaceSessions = Object.values(store.get(sessionsAtom)).filter(
          (session) => session.workspaceId === workspace.id
        );
        const preservedLateSessions = currentWorkspaceSessions.filter(
          (session) =>
            !workspaceSessionIdsAtRequestStart.has(session.id) &&
            !nextSessions.some((nextSession) => nextSession.id === session.id)
        );
        // Preserve sessions that were added after this fetch started so an older bootstrap
        // response cannot revert a freshly launched session back into the draft launcher.
        const mergedSessions = [...nextSessions, ...preservedLateSessions];

        setSessions((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([, session]) => session.workspaceId !== workspace.id)
          );

          for (const session of mergedSessions) {
            next[session.id] = session;
          }

          return next;
        });

        const currentLayout = store.get(paneLayoutAtomFamily(workspaceId));
        const workspacePaneLayout = normalizePaneLayout(workspace?.uiState.paneLayout);
        const legacyPaneLayout = workspacePaneLayout
          ? null
          : normalizePaneLayout(readLegacyPaneLayout(workspace.id));
        const baseLayout =
          workspacePaneLayout ?? legacyPaneLayout ?? currentLayout ?? defaultPaneLayout;
        const displayableSessionIds = new Set(
          mergedSessions.filter((session) => session.state !== "draft").map((session) => session.id)
        );
        const displayableSessions = mergedSessions.filter((session) => session.state !== "draft");
        const sanitized = sanitizePaneLayout(baseLayout, displayableSessionIds);
        let nextLayout = sanitized;
        const referencedSessionIds = new Set(collectSessionIds(nextLayout));
        const missingLiveSessionIds = mergedSessions
          .filter(
            (session) =>
              session.state !== "draft" &&
              session.state !== "ended" &&
              !referencedSessionIds.has(session.id)
          )
          .map((session) => session.id);

        if (missingLiveSessionIds.length > 0) {
          nextLayout = appendMissingSessions(nextLayout, missingLiveSessionIds);
        }

        const hasAnySessionInLayout = collectSessionIds(nextLayout).length > 0;
        if (!hasAnySessionInLayout) {
          if (displayableSessions.length > 0) {
            nextLayout = createFallbackPaneLayout(displayableSessions.map((session) => session.id));
          }
        }

        if (nextLayout !== currentLayout) {
          setPaneLayout(nextLayout);
        }

        const shouldPersistHydratedLayout =
          !workspacePaneLayout || legacyPaneLayout !== null || missingLiveSessionIds.length > 0;
        const hasPersistableLayout =
          legacyPaneLayout !== null || collectSessionIds(nextLayout).length > 0;
        if (shouldPersistHydratedLayout && hasPersistableLayout) {
          // If hydration had to repair a stale server layout, persist the repaired
          // tree immediately so later uiState writes do not re-clobber it.
          void persistUiState({ paneLayout: nextLayout }).then((persisted) => {
            if (persisted && legacyPaneLayout !== null) {
              clearLegacyPaneLayout(workspace.id);
            }
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to fetch sessions:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activationStatus,
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

function normalizePaneLayout(
  layout: Workspace["uiState"]["paneLayout"] | PaneNode | null | undefined
): PaneNode | null {
  if (!layout) {
    return null;
  }

  return {
    id: layout.id,
    type: layout.type,
    sessionId: layout.sessionId,
    direction: layout.direction,
    ratio: "ratio" in layout ? layout.ratio : undefined,
    children: layout.children?.map((child) => normalizePaneLayout(child) ?? defaultPaneLayout),
  };
}

function appendMissingSessions(layout: PaneNode, sessionIds: string[]): PaneNode {
  let nextLayout = layout;
  const initialSessionIds = collectSessionIds(nextLayout);
  let anchorSessionId = initialSessionIds[initialSessionIds.length - 1] ?? null;

  for (const sessionId of sessionIds) {
    nextLayout = appendSessionToLayout(nextLayout, sessionId, anchorSessionId, "horizontal");
    anchorSessionId = sessionId;
  }

  return nextLayout;
}
