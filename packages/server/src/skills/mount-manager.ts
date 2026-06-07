import { copyFile, lstat, mkdir, readdir, readlink, rm, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProviderDefinition, SkillMountRelation } from "@coder-studio/core";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";

interface SkillMountManagerDeps {
  getProviderRegistry: () => ProviderDefinition[];
  skillLibraryRepo: SkillLibraryRepo;
  skillMountRepo: SkillMountRepo;
}

export interface SkillMountPlan {
  providerId: string;
  skillSlug: string;
  enabled: boolean;
}

export class SkillMountManager {
  constructor(private readonly deps: SkillMountManagerDeps) {}

  listTargets() {
    return this.deps
      .getProviderRegistry()
      .map((provider) => ({
        providerId: provider.id,
        skillDir: provider.skillMountDirectories?.[0],
      }))
      .filter((target) => Boolean(target.skillDir));
  }

  async mount(input: SkillMountPlan): Promise<SkillMountRelation> {
    const libraryEntry = this.deps.skillLibraryRepo.get(input.skillSlug);
    const provider = this.deps.getProviderRegistry().find((item) => item.id === input.providerId);
    const skillDir = provider?.skillMountDirectories?.[0];

    if (!libraryEntry) {
      throw {
        code: "skill_not_installed",
        message: `Skill not installed: ${input.skillSlug}`,
      };
    }

    if (!skillDir) {
      throw {
        code: "skill_target_unconfigured",
        message: `Skill directory not configured for ${input.providerId}`,
      };
    }

    const targetPath = join(skillDir, input.skillSlug);
    const existing = this.deps.skillMountRepo.get(input.providerId, input.skillSlug);

    if (isSamePath(libraryEntry.libraryPath, targetPath)) {
      if (existing?.targetPath && !isSamePath(existing.targetPath, targetPath)) {
        await unlinkSafe(existing.targetPath);
      }
      const relation: SkillMountRelation = {
        providerId: input.providerId,
        skillSlug: input.skillSlug,
        enabled: input.enabled,
        sourcePath: libraryEntry.libraryPath,
        targetPath,
        mountModeResolved: await detectMountMode(targetPath),
        status: "mounted",
        lastSyncedAt: Date.now(),
      };
      this.deps.skillMountRepo.upsert(relation);
      return relation;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    if (existing?.targetPath) {
      await unlinkSafe(existing.targetPath);
    }

    let mountModeResolved: SkillMountRelation["mountModeResolved"] = "symlink";
    try {
      await rm(targetPath, { recursive: true, force: true });
      await symlink(libraryEntry.libraryPath, targetPath);
    } catch {
      mountModeResolved = "copy";
      await rm(targetPath, { recursive: true, force: true });
      await copyRecursively(libraryEntry.libraryPath, targetPath);
    }

    const relation: SkillMountRelation = {
      providerId: input.providerId,
      skillSlug: input.skillSlug,
      enabled: input.enabled,
      sourcePath: libraryEntry.libraryPath,
      targetPath,
      mountModeResolved,
      status: "mounted",
      lastSyncedAt: Date.now(),
    };
    this.deps.skillMountRepo.upsert(relation);
    return relation;
  }

  async unmount(providerId: string, skillSlug: string): Promise<void> {
    const relation = this.deps.skillMountRepo.get(providerId, skillSlug);
    if (!relation) {
      return;
    }

    if (!isSamePath(relation.sourcePath, relation.targetPath)) {
      await unlinkSafe(relation.targetPath);
    }
    this.deps.skillMountRepo.delete(providerId, skillSlug);
  }
}

function isSamePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
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

async function unlinkSafe(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    await rm(path, { recursive: true, force: true });
  }
}

async function copyRecursively(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyRecursively(from, to);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(from);
      await symlink(linkTarget, to);
    } else {
      await copyFile(from, to);
    }
  }
}
