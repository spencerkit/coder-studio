import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export interface SkillsPanelState {
  query: string;
  resolvedQuery: string;
  installJobIdBySlug: Record<string, string>;
  expandedSkillSlugs: string[];
  discoverCollapsed: boolean;
  libraryCollapsed: boolean;
}

function createInitialSkillsPanelState(): SkillsPanelState {
  return {
    query: "",
    resolvedQuery: "",
    installJobIdBySlug: {},
    expandedSkillSlugs: [],
    discoverCollapsed: false,
    libraryCollapsed: false,
  };
}

export const skillsPanelStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<SkillsPanelState>(createInitialSkillsPanelState())
);
