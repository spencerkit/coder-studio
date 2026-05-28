import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const focusedEditorPaneIdAtomFamily = atomFamily((workspaceId: string) =>
  atom<string | null>(null)
);

export const activeEditorPaneIdAtomFamily = atomFamily((workspaceId: string) =>
  atom<string | null>(null)
);
