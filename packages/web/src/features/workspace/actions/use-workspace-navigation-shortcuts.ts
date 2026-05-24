import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { activeWorkspaceAtom, orderedWorkspaceIdsAtom } from "../../../atoms/workspaces";
import { customShortcutsAtom, getEffectiveBinding, matchesShortcut } from "../../../lib/shortcuts";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { findAdjacentSessionId, type PaneDirection } from "../../agent-panes/pane-navigation";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";
import { useSelectWorkspaceTarget } from "./use-select-workspace-target";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

const SESSION_SHORTCUTS: Array<{ id: string; direction: PaneDirection }> = [
  { id: "session.navigate.left", direction: "left" },
  { id: "session.navigate.right", direction: "right" },
  { id: "session.navigate.up", direction: "up" },
  { id: "session.navigate.down", direction: "down" },
];

const WORKSPACE_SHORTCUTS: Array<{ id: string; step: -1 | 1 }> = [
  { id: "workspace.previous", step: -1 },
  { id: "workspace.next", step: 1 },
];

export function useWorkspaceNavigationShortcuts(workspaceId: string) {
  const store = useStore();
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const orderedWorkspaceIds = useAtomValue(orderedWorkspaceIdsAtom);
  const customBindings = useAtomValue(customShortcutsAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();
  const selectWorkspaceTarget = useSelectWorkspaceTarget();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const sessionShortcut = SESSION_SHORTCUTS.find(({ id }) =>
        matchesShortcut(event, getEffectiveBinding(id, customBindings))
      );
      if (sessionShortcut) {
        event.preventDefault();

        const workspace = activeWorkspace;
        if (!workspace || workspace.id !== workspaceId) {
          return;
        }

        const activeSessionId = workspace.uiState.activeSessionId;
        if (!activeSessionId) {
          return;
        }

        const layout = store.get(paneLayoutAtomFamily(workspaceId));
        const nextSessionId = findAdjacentSessionId(
          layout,
          activeSessionId,
          sessionShortcut.direction
        );
        if (!nextSessionId) {
          return;
        }

        void persistLastViewedTarget({
          workspaceId,
          sessionId: nextSessionId,
        });
        void persistUiState({ activeSessionId: nextSessionId });
        return;
      }

      const workspaceShortcut = WORKSPACE_SHORTCUTS.find(({ id }) =>
        matchesShortcut(event, getEffectiveBinding(id, customBindings))
      );
      if (!workspaceShortcut) {
        return;
      }

      event.preventDefault();

      const currentWorkspaceId = activeWorkspace?.id ?? workspaceId;
      const currentIndex = orderedWorkspaceIds.indexOf(currentWorkspaceId);
      if (currentIndex === -1) {
        return;
      }

      const nextWorkspaceId = orderedWorkspaceIds[currentIndex + workspaceShortcut.step];
      if (!nextWorkspaceId) {
        return;
      }

      void selectWorkspaceTarget(nextWorkspaceId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeWorkspace,
    customBindings,
    orderedWorkspaceIds,
    persistLastViewedTarget,
    persistUiState,
    selectWorkspaceTarget,
    store,
    workspaceId,
  ]);
}
