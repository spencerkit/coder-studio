import { constants } from "node:fs";
import { access, lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProviderDefinition, SkillMountRelation } from "@coder-studio/core";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";

export interface SkillTargetHealthEntry {
  state: "healthy" | "warning" | "error" | "unconfigured";
  error?: string;
}

export class SkillHealthManager {
  constructor(
    private readonly deps: {
      getProviderRegistry: () => ProviderDefinition[];
      skillLibraryRepo: SkillLibraryRepo;
    }
  ) {}

  async listTargetHealth(): Promise<Record<string, SkillTargetHealthEntry>> {
    const entries: Record<string, SkillTargetHealthEntry> = {};
    for (const provider of this.deps.getProviderRegistry()) {
      const skillDir = provider.skillMountDirectories?.[0];
      if (!skillDir) {
        entries[provider.id] = { state: "unconfigured" };
        continue;
      }

      try {
        await access(skillDir, constants.F_OK | constants.W_OK);
        entries[provider.id] = { state: "healthy" };
      } catch (error) {
        entries[provider.id] = {
          state: "warning",
          error: error instanceof Error ? error.message : "Skill directory unavailable",
        };
      }
    }
    return entries;
  }

  async discoverMounts(existingRelations: SkillMountRelation[]): Promise<SkillMountRelation[]> {
    const libraryEntries = new Map(
      this.deps.skillLibraryRepo.list().map((entry) => [entry.slug, entry])
    );
    const relationByKey = new Map(
      existingRelations.map((relation) => [
        relationKey(relation.providerId, relation.skillSlug),
        relation,
      ])
    );
    const selectedRelationKeys = new Set<string>();
    const discovered: SkillMountRelation[] = [];

    for (const provider of this.deps.getProviderRegistry()) {
      if (provider.supportsSkillsMount !== true) {
        continue;
      }

      for (const skillDir of provider.skillMountDirectories ?? []) {
        const skillSlugs = await listMountedSkillSlugs(skillDir);
        for (const skillSlug of skillSlugs) {
          const libraryEntry = libraryEntries.get(skillSlug);
          if (!libraryEntry) {
            continue;
          }

          const key = relationKey(provider.id, skillSlug);
          if (selectedRelationKeys.has(key)) {
            continue;
          }

          const existing = relationByKey.get(key);
          const targetPath = join(skillDir, skillSlug);
          if (
            existing &&
            isSamePath(existing.targetPath, targetPath) &&
            (await hasSkillMarkdown(existing.targetPath))
          ) {
            selectedRelationKeys.add(key);
            continue;
          }

          const relation: SkillMountRelation = {
            providerId: provider.id,
            skillSlug,
            enabled: existing?.enabled ?? true,
            sourcePath: libraryEntry.libraryPath,
            targetPath,
            mountModeResolved: await detectMountMode(targetPath),
            status: "mounted",
            lastSyncedAt: Date.now(),
          };
          relationByKey.set(key, relation);
          selectedRelationKeys.add(key);
          discovered.push(relation);
        }
      }
    }

    return discovered;
  }

  async scanMount(relation: SkillMountRelation): Promise<SkillMountRelation> {
    const provider = this.deps
      .getProviderRegistry()
      .find((item) => item.id === relation.providerId);
    if (!provider) {
      return {
        ...relation,
        status: "failed",
        lastError: `Provider no longer exists: ${relation.providerId}`,
      };
    }

    const libraryEntry = this.deps.skillLibraryRepo.get(relation.skillSlug);
    if (!libraryEntry) {
      return {
        ...relation,
        status: "missing_source",
        lastError: `Skill source missing: ${relation.skillSlug}`,
      };
    }

    try {
      await access(relation.sourcePath, constants.F_OK);
      await access(relation.targetPath, constants.F_OK);
      const stat = await lstat(relation.targetPath);
      if (stat.isSymbolicLink()) {
        const resolved = await realpath(relation.targetPath);
        if (resolved !== relation.sourcePath) {
          return { ...relation, status: "stale", lastError: "mount drift detected" };
        }
      }
      return { ...relation, status: "mounted", lastError: undefined };
    } catch (error) {
      return {
        ...relation,
        status: "missing_target",
        lastError: error instanceof Error ? error.message : "missing target",
      };
    }
  }
}

function relationKey(providerId: string, skillSlug: string): string {
  return `${providerId}:${skillSlug}`;
}

function isSamePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

async function listMountedSkillSlugs(skillDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(skillDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    if (await hasSkillMarkdown(join(skillDir, entry.name))) {
      slugs.push(entry.name);
    }
  }

  return slugs;
}

async function hasSkillMarkdown(skillPath: string): Promise<boolean> {
  try {
    await access(join(skillPath, "SKILL.md"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectMountMode(
  targetPath: string
): Promise<SkillMountRelation["mountModeResolved"]> {
  try {
    const stat = await lstat(targetPath);
    return stat.isSymbolicLink() ? "symlink" : "copy";
  } catch {
    return "copy";
  }
}
