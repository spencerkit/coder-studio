import type { FileNode } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type {
  CreateDialogState,
  PendingDeleteState,
  RenameDialogState,
} from "../actions/use-file-actions";

export interface SkillsPanelState {
  query: string;
  resolvedQuery: string;
  installJobIdBySlug: Record<string, string>;
  customCollapsed: boolean;
  installedCollapsed: boolean;
  builtinCollapsed: boolean;
  discoverCollapsed: boolean;
  recommendationsCollapsed: boolean;
}

function createInitialSkillsPanelState(): SkillsPanelState {
  return {
    query: "",
    resolvedQuery: "",
    installJobIdBySlug: {},
    customCollapsed: false,
    installedCollapsed: true,
    builtinCollapsed: true,
    discoverCollapsed: false,
    recommendationsCollapsed: false,
  };
}

export const skillsPanelStateAtomFamily = atomFamily((_workspaceId: string) =>
  atom<SkillsPanelState>(createInitialSkillsPanelState())
);

export const customSkillFileTreeAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<Map<string, FileNode[]> | null>(null))
);

export const customSkillLoadedDirsAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<Set<string>>(new Set<string>()))
);

export const customSkillExpandedDirsAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<Set<string>>(new Set<string>()))
);

export const customSkillCreateDialogAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<CreateDialogState | null>(null))
);

export const customSkillRenameDialogAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<RenameDialogState | null>(null))
);

export const customSkillPendingDeleteAtomFamily = atomFamily((_workspaceId: string) =>
  atomFamily((_skillSlug: string) => atom<PendingDeleteState | null>(null))
);
