import type { Workspace } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  bottomPanelHeightAtomFamily,
  focusModeAtomFamily,
  leftPanelWidthAtomFamily,
} from "../atoms";

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Workspace>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.uiState === "object" &&
    candidate.uiState !== null
  );
}

export function useWorkspaceUiStatePersistence(workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const store = useStore();

  const persistUiState = useCallback(
    async (patch: Partial<Workspace["uiState"]>) => {
      if (!workspaceId || workspaceId.startsWith("__workspace_")) {
        return false;
      }

      const workspace = store.get(workspacesAtom)[workspaceId];
      if (!workspace) {
        return false;
      }

      const nextUiState: Workspace["uiState"] = {
        ...workspace.uiState,
        leftPanelWidth: store.get(leftPanelWidthAtomFamily(workspaceId)),
        bottomPanelHeight: store.get(bottomPanelHeightAtomFamily(workspaceId)),
        focusMode: store.get(focusModeAtomFamily(workspaceId)),
        paneLayout: store.get(paneLayoutAtomFamily(workspaceId)),
        ...patch,
      };

      setWorkspaces((previous) => {
        const current = previous[workspaceId];
        if (!current) {
          return previous;
        }

        return {
          ...previous,
          [workspaceId]: {
            ...current,
            uiState: nextUiState,
          },
        };
      });

      try {
        const result = await dispatch<Workspace>("workspace.uiState.set", {
          workspaceId,
          uiState: nextUiState,
        });

        if (!result.ok) {
          console.error("Failed to persist workspace ui state:", result.error?.message);
          return false;
        }

        if (isWorkspace(result.data)) {
          setWorkspaces((previous) => ({
            ...previous,
            [workspaceId]: result.data,
          }));
        }

        return true;
      } catch (error) {
        console.error("Failed to persist workspace ui state:", error);
        return false;
      }
    },
    [dispatch, setWorkspaces, store, workspaceId]
  );

  return {
    persistUiState,
  };
}
