import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";
import { writeManagedSkillMarker } from "./managed-skill-metadata.js";

export function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function createCustomSkill(input: {
  rootDir: string;
  name: string;
}): Promise<SkillLibraryEntry> {
  const displayName = input.name.trim();
  const slug = slugifySkillName(displayName);

  if (!slug) {
    throw { code: "invalid_skill_name", message: "Skill name must produce a valid slug" };
  }

  const libraryPath = join(input.rootDir, slug);
  await mkdir(input.rootDir, { recursive: true });
  await mkdir(libraryPath, { recursive: false });

  const markdown = [
    "---",
    `name: ${slug}`,
    "description: Custom skill",
    "---",
    "",
    `# ${displayName}`,
    "",
  ].join("\n");

  await writeFile(join(libraryPath, "SKILL.md"), markdown, "utf8");
  writeManagedSkillMarker(libraryPath, {
    version: 1,
    managedBy: "coder-studio",
    source: "custom",
    slug,
  });

  const now = Date.now();
  return {
    slug,
    displayName,
    description: "Custom skill",
    version: "local",
    source: "custom",
    origin: "filesystem",
    libraryPath,
    installState: "installed",
    installedAt: now,
    updatedAt: now,
  };
}
