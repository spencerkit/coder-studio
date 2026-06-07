import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { PendingEditorNavigation } from "../../code-editor/atoms";
import type { WorkspaceEditorMode } from "../../workspace/atoms";

export const focusedEditorPaneIdAtomFamily = atomFamily(() => atom<string | null>(null));

export const activeEditorPaneIdAtomFamily = atomFamily(() => atom<string | null>(null));

export function getEditorPaneStateKey(workspaceId: string, paneId: string): string {
  return `${workspaceId}::${paneId}`;
}

export const editorPaneActiveFilePathAtomFamily = atomFamily(() => atom<string | null>(null));

export const editorPaneModeAtomFamily = atomFamily(() => atom<WorkspaceEditorMode>("preview"));

export const editorPanePendingNavigationAtomFamily = atomFamily(() =>
  atom<PendingEditorNavigation | null>(null)
);
