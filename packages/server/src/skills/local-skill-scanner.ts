import type { Dirent } from "node:fs";
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";

interface SkillMarkdownMetadata {
  description?: string;
  version?: string;
}

export function resolveDefaultLocalSkillRoots(): string[] {
  if (process.env.NODE_ENV === "test") {
    return [];
  }

  return [join(homedir(), ".agents", "skills")];
}

export function scanLocalSkillEntries(roots: string[]): SkillLibraryEntry[] {
  const discovered = new Map<string, SkillLibraryEntry>();

  for (const root of roots) {
    for (const entry of scanLocalSkillRoot(root)) {
      if (!discovered.has(entry.slug)) {
        discovered.set(entry.slug, entry);
      }
    }
  }

  return [...discovered.values()];
}

function scanLocalSkillRoot(root: string): SkillLibraryEntry[] {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillLibraryEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
      continue;
    }

    const skillDir = join(root, dirent.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      accessSync(skillMdPath, constants.F_OK);
      const markdown = readFileSync(skillMdPath, "utf8");
      const metadata = parseSkillMarkdownFrontmatter(markdown);
      const stats = statSync(skillMdPath);
      const updatedAt = Math.trunc(stats.mtimeMs || Date.now());
      const installedAt = Math.trunc(stats.birthtimeMs || updatedAt);

      skills.push({
        slug: dirent.name,
        displayName: toDisplayName(dirent.name),
        description: metadata.description,
        version: metadata.version ?? "local",
        source: "local",
        libraryPath: skillDir,
        installState: "installed",
        installedAt,
        updatedAt,
      });
    } catch {
      continue;
    }
  }

  return skills;
}

function parseSkillMarkdownFrontmatter(markdown: string): SkillMarkdownMetadata {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return {};
  }

  const frontmatter = match[1];
  if (!frontmatter) {
    return {};
  }

  const metadata: SkillMarkdownMetadata = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) {
      continue;
    }

    const key = pair[1];
    const rawValue = pair[2];
    if (!key || rawValue === undefined) {
      continue;
    }

    const value = unquoteYamlScalar(rawValue.trim());
    if (!value) {
      continue;
    }

    if (key.trim() === "description") {
      metadata.description = value;
      continue;
    }

    if (key.trim() === "version") {
      metadata.version = value;
    }
  }

  return metadata;
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function toDisplayName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
