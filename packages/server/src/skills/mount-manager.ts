import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ProviderDefinition, SkillMountRelation } from "@coder-studio/core";
import { renameWithRetry } from "../fs/rename-with-retry.js";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";

const MOUNT_STAGING_DIR_NAME = ".coder-studio-mount-staging";

interface SkillMountManagerDeps {
  getProviderRegistry: () => ProviderDefinition[];
  skillLibraryRepo: SkillLibraryRepo;
  skillMountRepo: SkillMountRepo;
}

export interface SkillMountPlan {
  providerId: string;
  skillSlug: string;
  enabled: boolean;
  preferredMode?: "auto" | "copy";
  mountedOverrides?: Array<{ relativePath: string; content: string }>;
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
    if (existing?.targetPath && !isSamePath(existing.targetPath, targetPath)) {
      await unlinkSafe(existing.targetPath);
    }

    const shouldCopyMount =
      input.preferredMode === "copy" || (input.mountedOverrides?.length ?? 0) > 0;

    let mountModeResolved: SkillMountRelation["mountModeResolved"] = "symlink";
    if (shouldCopyMount) {
      mountModeResolved = "copy";
      await materializeCopyMount({
        sourcePath: libraryEntry.libraryPath,
        targetPath,
        mountedOverrides: input.mountedOverrides,
      });
    } else {
      try {
        await materializeSymlinkMount(libraryEntry.libraryPath, targetPath);
      } catch {
        mountModeResolved = "copy";
        await materializeCopyMount({
          sourcePath: libraryEntry.libraryPath,
          targetPath,
          mountedOverrides: input.mountedOverrides,
        });
      }
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

interface MaterializeCopyMountInput {
  sourcePath: string;
  targetPath: string;
  mountedOverrides?: Array<{ relativePath: string; content: string }>;
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

async function unlinkIfSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      await unlink(path);
    }
  } catch {
    return;
  }
}

async function materializeCopyMount(input: MaterializeCopyMountInput): Promise<void> {
  await replaceMountedPath(input.targetPath, async (stagedPath) => {
    await copyRecursively(input.sourcePath, stagedPath);
    await applyMountedOverrides(stagedPath, input.mountedOverrides);
  });
}

async function materializeSymlinkMount(sourcePath: string, targetPath: string): Promise<void> {
  await replaceMountedPath(targetPath, async (stagedPath) => {
    await symlink(sourcePath, stagedPath);
  });
}

async function applyMountedOverrides(
  targetPath: string,
  mountedOverrides?: Array<{ relativePath: string; content: string }>
): Promise<void> {
  for (const override of mountedOverrides ?? []) {
    const overridePath = join(targetPath, override.relativePath);
    await mkdir(dirname(overridePath), { recursive: true });
    await unlinkIfSymlink(overridePath);
    await writeFile(overridePath, override.content, "utf8");
  }
}

async function replaceMountedPath(
  targetPath: string,
  materialize: (stagedPath: string) => Promise<void>
): Promise<void> {
  const stagingRoot = join(dirname(targetPath), MOUNT_STAGING_DIR_NAME);
  const token = randomUUID();
  const stagedPath = join(stagingRoot, `${basename(targetPath)}-${token}`);
  const backupPath = join(stagingRoot, `${basename(targetPath)}-backup-${token}`);
  let hasBackup = false;

  await mkdir(stagingRoot, { recursive: true });

  try {
    await materialize(stagedPath);

    if (await pathExists(targetPath)) {
      await renameWithRetry(targetPath, backupPath, { rename });
      hasBackup = true;
    }

    try {
      await renameWithRetry(stagedPath, targetPath, { rename });
    } catch (error) {
      if (hasBackup) {
        await restoreMountedPathBackup(backupPath, targetPath);
        hasBackup = false;
      }
      throw error;
    }

    if (hasBackup) {
      await unlinkSafe(backupPath);
    }
  } catch (error) {
    await removeIfExists(stagedPath);
    if (hasBackup) {
      await restoreMountedPathBackup(backupPath, targetPath).catch(() => undefined);
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(path: string): Promise<void> {
  if (!(await pathExists(path))) {
    return;
  }

  await unlinkSafe(path);
}

async function restoreMountedPathBackup(backupPath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(backupPath))) {
    return;
  }

  await renameWithRetry(backupPath, targetPath, { rename });
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
