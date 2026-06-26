import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CODER_STUDIO_SKILL_MARKER = ".coder-studio-skill.json";

export interface ManagedSkillMarker {
  version: 1;
  managedBy: "coder-studio";
  source: "builtin" | "custom";
  slug: string;
}

function isManagedSkillMarker(value: unknown): value is ManagedSkillMarker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ManagedSkillMarker>;
  return (
    candidate.version === 1 &&
    candidate.managedBy === "coder-studio" &&
    (candidate.source === "builtin" || candidate.source === "custom") &&
    typeof candidate.slug === "string" &&
    candidate.slug.trim().length > 0
  );
}

export function readManagedSkillMarker(skillDir: string): ManagedSkillMarker | undefined {
  try {
    const raw = readFileSync(join(skillDir, CODER_STUDIO_SKILL_MARKER), "utf8");
    const parsed = JSON.parse(raw);
    return isManagedSkillMarker(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeManagedSkillMarker(skillDir: string, marker: ManagedSkillMarker): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, CODER_STUDIO_SKILL_MARKER),
    `${JSON.stringify(marker, null, 2)}\n`,
    "utf8"
  );
}
