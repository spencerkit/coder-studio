export const SKILL_EDITOR_PATH_PREFIX = "skill:";

export interface ParsedSkillEditorPath {
  skillSlug: string;
  relativePath: string;
}

export function toSkillEditorPath(skillSlug: string, relativePath: string): string {
  return `${SKILL_EDITOR_PATH_PREFIX}${skillSlug}/${relativePath}`;
}

export function parseSkillEditorPath(path: string): ParsedSkillEditorPath | null {
  if (!path.startsWith(SKILL_EDITOR_PATH_PREFIX)) {
    return null;
  }

  const rawTarget = path.slice(SKILL_EDITOR_PATH_PREFIX.length);
  const separatorIndex = rawTarget.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === rawTarget.length - 1) {
    return null;
  }

  const skillSlug = rawTarget.slice(0, separatorIndex).trim();
  const relativePath = rawTarget.slice(separatorIndex + 1).trim();
  if (!skillSlug || !relativePath) {
    return null;
  }

  return {
    skillSlug,
    relativePath,
  };
}

export function isSkillEditorPath(path: string): boolean {
  return parseSkillEditorPath(path) !== null;
}
