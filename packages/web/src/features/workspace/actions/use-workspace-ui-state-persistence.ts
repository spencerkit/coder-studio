import type { Workspace } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import {
  type PaneNode,
  paneLayoutAtomFamily,
  toWorkspacePaneLayout,
} from "../../agent-panes/atoms/pane-layout";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  bottomPanelHeightAtomFamily,
  editorViewVisibleAtomFamily,
  focusModeAtomFamily,
  leftPanelWidthAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
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

type WorkspaceUiStatePatch = Omit<Partial<Workspace["uiState"]>, "paneLayout"> & {
  paneLayout?: Workspace["uiState"]["paneLayout"] | PaneNode;
};

function stripLegacyDevBrowserTargetUrl(
  uiState: Workspace["uiState"] | null | undefined
): Partial<Omit<Workspace["uiState"], "devBrowserTargetUrl">> {
  if (!uiState || typeof uiState !== "object") {
    return {};
  }

  const { devBrowserTargetUrl: _legacyBrowserTargetUrl, ...restUiState } = uiState;
  return restUiState;
}

export function useWorkspaceUiStatePersistence(workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const store = useStore();

  const persistUiState = useCallback(
    async (patch: WorkspaceUiStatePatch) => {
      if (!workspaceId || workspaceId.startsWith("__workspace_")) {
        return false;
      }

      const workspace = store.get(workspacesAtom)[workspaceId];
      if (!workspace) {
        return false;
      }

      const currentOpenEditorPaths = store.get(openEditorPathsAtomFamily(workspaceId));
      const currentActiveEditorPath = store.get(activeFilePathAtomFamily(workspaceId));
      const currentEditorViewVisible = store.get(editorViewVisibleAtomFamily(workspaceId));
      const currentOpenEditorTabs = store.get(openEditorTabsAtomFamily(workspaceId));
      const currentActiveEditorTab = store.get(activeEditorTabAtomFamily(workspaceId));
      const currentPaneLayout = store.get(paneLayoutAtomFamily(workspaceId));
      const { paneLayout: patchPaneLayout, ...restPatch } = patch;
      const baseUiState = stripLegacyDevBrowserTargetUrl(workspace.uiState);
      const { devBrowserTargetUrl: _legacyBrowserTargetUrl, ...sanitizedPatch } = restPatch;
      const shouldIncludeEditorState =
        workspace.uiState?.openEditorPaths !== undefined ||
        workspace.uiState?.activeEditorPath !== undefined ||
        currentOpenEditorPaths.length > 0 ||
        currentActiveEditorPath !== null;
      const shouldIncludeBrowserEditorState =
        workspace.uiState?.openEditorTabs !== undefined ||
        workspace.uiState?.activeEditorTab !== undefined ||
        currentOpenEditorTabs.some((tab) => tab.kind === "browser") ||
        currentActiveEditorTab?.kind === "browser";

      const nextUiState: Workspace["uiState"] = {
        ...baseUiState,
        leftPanelWidth: store.get(leftPanelWidthAtomFamily(workspaceId)),
        bottomPanelHeight: store.get(bottomPanelHeightAtomFamily(workspaceId)),
        focusMode: store.get(focusModeAtomFamily(workspaceId)),
        editorViewVisible: currentEditorViewVisible,
        paneLayout: toWorkspacePaneLayout(patchPaneLayout ?? currentPaneLayout),
        ...(shouldIncludeEditorState
          ? {
              openEditorPaths: currentOpenEditorPaths,
              activeEditorPath: currentActiveEditorPath,
            }
          : {}),
        ...(shouldIncludeBrowserEditorState
          ? {
              openEditorTabs: currentOpenEditorTabs,
              activeEditorTab: currentActiveEditorTab,
            }
          : {}),
        ...sanitizedPatch,
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

      if (!wsClient) {
        return true;
      }

      try {
        const result = await dispatch<Workspace>("workspace.uiState.set", {
          workspaceId,
          uiState: nextUiState,
        });

        if (!result.ok) {
          console.error("Failed to persist workspace ui state:", result.error?.message);
          return false;
        }

        const persistedWorkspace = result.data;
        if (isWorkspace(persistedWorkspace)) {
          setWorkspaces((previous) => ({
            ...previous,
            [workspaceId]: persistedWorkspace,
          }));
        }

        return true;
      } catch (error) {
        console.error("Failed to persist workspace ui state:", error);
        return false;
      }
    },
    [dispatch, setWorkspaces, store, workspaceId, wsClient]
  );

  return {
    persistUiState,
  };
}
