import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export interface PendingEditorNavigation {
  workspaceId: string;
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source: "manual" | "file-tree" | "lsp" | "search";
}

export const pendingEditorNavigationAtomFamily = atomFamily((workspaceId: string) =>
  atom<PendingEditorNavigation | null>(null)
);
