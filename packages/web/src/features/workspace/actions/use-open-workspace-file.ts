import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { usePaneActions } from "../../agent-panes/actions/use-pane-actions";
import {
  activeEditorPaneIdAtomFamily,
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPaneOpenEditorPathsAtomFamily,
  editorPanePendingNavigationAtomFamily,
  focusedEditorPaneIdAtomFamily,
  getEditorPaneStateKey,
} from "../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  paneLayoutHasDraftPaneId,
  paneLayoutHasEditorPaneId,
} from "../../agent-panes/pane-layout-tree";
import { useOpenLocation } from "../../code-editor/actions/use-open-location";
import { type PendingEditorNavigation } from "../../code-editor/atoms";
import {
  activeEditorTabAtomFamily,
  createWorkspaceCanvasEditorTabFromSourcePath,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  editorViewVisibleAtomFamily,
  isCanvasSourcePath,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import { appendOpenEditorPath } from "./open-editor-state";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

interface OpenWorkspaceFileOptions {
  targetDraftPaneId?: string;
  openTarget?: "source" | "navigate";
  openDisposition?: "preview" | "pinned" | "preserve";
}

function resolveOpenWorkspaceTarget(
  input: PendingEditorNavigation,
  options: OpenWorkspaceFileOptions
): "source" | "canvas" {
  if (options.openTarget !== "navigate") {
    return "source";
  }

  if (options.targetDraftPaneId) {
    return "source";
  }

  if (
    input.line !== undefined ||
    input.column !== undefined ||
    input.endLine !== undefined ||
    input.endColumn !== undefined
  ) {
    return "source";
  }

  return isCanvasSourcePath(input.path) ? "canvas" : "source";
}

export function useOpenWorkspaceFile(workspaceId: string) {
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const activeEditorPaneId = useAtomValue(activeEditorPaneIdAtomFamily(workspaceId));
  const setActiveEditorPaneId = useSetAtom(activeEditorPaneIdAtomFamily(workspaceId));
  const setActiveEditorTab = useSetAtom(activeEditorTabAtomFamily(workspaceId));
  const setFocusedEditorPaneId = useSetAtom(focusedEditorPaneIdAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const setEditorViewVisible = useSetAtom(editorViewVisibleAtomFamily(workspaceId));
  const setOpenEditorPaths = useSetAtom(openEditorPathsAtomFamily(workspaceId));
  const setOpenEditorTabs = useSetAtom(openEditorTabsAtomFamily(workspaceId));
  const store = useStore();
  const { openLocation } = useOpenLocation(workspaceId);
  const { convertDraftPane } = usePaneActions(workspaceId);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const nextEditorPaneRequestIdRef = useRef(0);

  const openWorkspaceFile = useCallback(
    async (input: PendingEditorNavigation, options: OpenWorkspaceFileOptions = {}) => {
      const resolvedOpenTarget = resolveOpenWorkspaceTarget(input, options);
      let targetEditorPaneId: string | null = null;

      if (resolvedOpenTarget === "source" && options.targetDraftPaneId) {
        if (paneLayoutHasDraftPaneId(paneLayout, options.targetDraftPaneId)) {
          convertDraftPane(options.targetDraftPaneId);
          targetEditorPaneId = options.targetDraftPaneId;
        } else if (paneLayoutHasEditorPaneId(paneLayout, options.targetDraftPaneId)) {
          targetEditorPaneId = options.targetDraftPaneId;
        }

        if (targetEditorPaneId) {
          const editorPaneStateKey = getEditorPaneStateKey(workspaceId, targetEditorPaneId);
          const paneOpenEditorPathsAtom = editorPaneOpenEditorPathsAtomFamily(editorPaneStateKey);
          setFocusedEditorPaneId(targetEditorPaneId);
          setActiveEditorPaneId(targetEditorPaneId);
          store.set(
            editorPaneModeAtomFamily(editorPaneStateKey),
            deriveEditorModeForPath(input.path)
          );
          store.set(editorPaneActiveFilePathAtomFamily(editorPaneStateKey), input.path);
          store.set(
            paneOpenEditorPathsAtom,
            appendOpenEditorPath(store.get(paneOpenEditorPathsAtom), input.path)
          );
          store.set(editorPanePendingNavigationAtomFamily(editorPaneStateKey), {
            ...input,
            requestId: ++nextEditorPaneRequestIdRef.current,
          });
          return;
        }
      }

      setFocusedEditorPaneId(null);
      if (activeEditorPaneId && !paneLayoutHasEditorPaneId(paneLayout, activeEditorPaneId)) {
        setActiveEditorPaneId(null);
      }

      if (resolvedOpenTarget === "canvas") {
        const currentOpenEditorTabs = store.get(openEditorTabsAtomFamily(workspaceId));
        const openFiles = store.get(openFilesAtomFamily(workspaceId));
        const existingCanvasTab = currentOpenEditorTabs.find(
          (tab) => tab.kind === "canvas" && tab.sourcePath === input.path
        );
        const nextCanvasTab = createWorkspaceCanvasEditorTabFromSourcePath({
          sourcePath: input.path,
          file: openFiles[input.path],
          existingTab: existingCanvasTab,
        });
        const nextOpenEditorTabs = existingCanvasTab
          ? currentOpenEditorTabs.map((tab) => (tab === existingCanvasTab ? nextCanvasTab : tab))
          : [...currentOpenEditorTabs, nextCanvasTab];

        setEditorViewVisible(true);
        setOpenEditorTabs(nextOpenEditorTabs);
        setActiveEditorTab(nextCanvasTab);
        void persistUiState({
          editorViewVisible: true,
          openEditorTabs: nextOpenEditorTabs,
          activeEditorTab: nextCanvasTab,
        });
        return;
      }

      setEditorMode(deriveEditorModeForPath(input.path));
      await openLocation(input);
      const openDisposition = options.openDisposition ?? "pinned";
      const currentOpenEditorTabs = store.get(openEditorTabsAtomFamily(workspaceId));
      const existingFileTab = currentOpenEditorTabs.find(
        (tab) => tab.kind === "file" && tab.path === input.path
      );
      const existingPreviewTab = currentOpenEditorTabs.find(
        (tab) => tab.kind === "file" && tab.pinned === false
      );
      const shouldPinFileTab =
        openDisposition === "pinned" ||
        openDisposition === "preserve" ||
        (openDisposition === "preview" && existingFileTab?.pinned === true);
      const nextFileTab = {
        kind: "file" as const,
        path: input.path,
        pinned: shouldPinFileTab,
      };
      const nextOpenEditorTabs = existingFileTab
        ? currentOpenEditorTabs.map((tab) => (tab === existingFileTab ? nextFileTab : tab))
        : openDisposition === "preview" && existingPreviewTab
          ? currentOpenEditorTabs.map((tab) => (tab === existingPreviewTab ? nextFileTab : tab))
          : [...currentOpenEditorTabs, nextFileTab];
      const currentOpenEditorPaths = store.get(openEditorPathsAtomFamily(workspaceId));
      const nextOpenEditorPaths = shouldPinFileTab
        ? appendOpenEditorPath(currentOpenEditorPaths, input.path)
        : currentOpenEditorPaths;
      setOpenEditorPaths(nextOpenEditorPaths);
      setOpenEditorTabs(nextOpenEditorTabs);
      setActiveEditorTab(nextFileTab);
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        openEditorTabs: nextOpenEditorTabs,
        activeEditorTab: nextFileTab,
        activeEditorPath: input.path,
      });
    },
    [
      activeEditorPaneId,
      convertDraftPane,
      openLocation,
      paneLayout,
      persistUiState,
      setActiveEditorPaneId,
      setActiveEditorTab,
      setEditorMode,
      setEditorViewVisible,
      setFocusedEditorPaneId,
      setOpenEditorPaths,
      setOpenEditorTabs,
      store,
      workspaceId,
    ]
  );

  return { openWorkspaceFile };
}
