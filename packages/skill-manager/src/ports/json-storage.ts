export const SKILL_JSON_DOCUMENTS = ["skills.library", "skills.mounts", "skills.targets"] as const;

export type SkillJsonDocumentName = (typeof SKILL_JSON_DOCUMENTS)[number];

/**
 * Physical persistence is supplied by the host. The skill-manager package owns
 * document schemas and mutations, but never chooses files, databases, or keys.
 */
export interface SkillJsonStorage {
  read(name: SkillJsonDocumentName): unknown | undefined;
  write(name: SkillJsonDocumentName, value: unknown): void;
}
