import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export interface SkillsPanelState {
  query: string;
  resolvedQuery: string;
  installJobIdBySlug: Record<string, string>;
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
    installedCollapsed: true,
    builtinCollapsed: true,
    discoverCollapsed: false,
    recommendationsCollapsed: false,
  };
}

export const skillsPanelStateAtomFamily = atomFamily((_workspaceId: string) =>
  atom<SkillsPanelState>(createInitialSkillsPanelState())
);
