import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";
import { writeManagedSkillMarker } from "../managed-skill-metadata.js";
import { BUILTIN_SKILLS, type BuiltinSkillDefinition } from "./definitions/index.js";

export interface MaterializeBuiltinSkillsInput {
  builtinRoot: string;
  now?: () => number;
  skills?: readonly BuiltinSkillDefinition[];
}

export async function materializeBuiltinSkills(
  input: MaterializeBuiltinSkillsInput
): Promise<SkillLibraryEntry[]> {
  const now = input.now?.() ?? Date.now();
  const skills = input.skills ?? BUILTIN_SKILLS;
  const entries: SkillLibraryEntry[] = [];

  for (const skill of skills) {
    const libraryPath = join(input.builtinRoot, skill.slug);
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), `${skill.content.trimEnd()}\n`, "utf8");
    for (const managedFile of skill.files ?? []) {
      const managedFilePath = join(libraryPath, managedFile.relativePath);
      await mkdir(dirname(managedFilePath), { recursive: true });
      await writeFile(managedFilePath, `${managedFile.content.trimEnd()}\n`, "utf8");
    }
    writeManagedSkillMarker(libraryPath, {
      version: 1,
      managedBy: "coder-studio",
      source: "builtin",
      slug: skill.slug,
    });
    entries.push({
      slug: skill.slug,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      source: "builtin",
      origin: "builtin",
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
