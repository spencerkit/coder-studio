export * from "@coder-studio/skill-manager";

/** Coder Studio workspace-intelligence extension; not part of the reusable Skill Manager. */
export interface SkillRecommendationEntry {
  slug: string;
  registryRef?: string;
  displayName: string;
  description?: string;
  reason: string;
  sourceQuery: string;
  score: number;
  installed: boolean;
}

export interface SkillRecommendationPage {
  entries: SkillRecommendationEntry[];
  hasMore: boolean;
}
