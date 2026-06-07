import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";
import { BUILTIN_SKILLS } from "./registry.js";

export interface MaterializeBuiltinSkillsInput {
  builtinRoot: string;
  now?: () => number;
}

export async function materializeBuiltinSkills(
  input: MaterializeBuiltinSkillsInput
): Promise<SkillLibraryEntry[]> {
  const now = input.now?.() ?? Date.now();
  const entries: SkillLibraryEntry[] = [];

  for (const skill of BUILTIN_SKILLS) {
    const libraryPath = join(input.builtinRoot, skill.slug);
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), `${skill.content.trimEnd()}\n`, "utf8");
    entries.push({
      slug: skill.slug,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      source: "builtin",
      libraryPath,
      installState: "installed",
      installedAt: now,
      updatedAt: now,
      builtin: {
        defaultEnabled: skill.defaultEnabled,
        autoMount: skill.autoMountInMvp,
      },
    });
  }

  return entries;
}
