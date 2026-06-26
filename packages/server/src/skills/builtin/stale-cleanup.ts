import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, readlink, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ProviderDefinition, SkillLibraryEntry } from "@coder-studio/core";
import type { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { SkillMountManager } from "../mount-manager.js";
import { BuiltinSkillMountPreferences } from "./mount-preferences.js";

export interface RemoveStaleBuiltinSkillsInput {
  builtinRoot: string;
  currentEntries: SkillLibraryEntry[];
  libraryRepo: SkillLibraryRepo;
  mountRepo: SkillMountRepo;
  mountManager: SkillMountManager;
  getProviderRegistry: () => ProviderDefinition[];
  preferences: BuiltinSkillMountPreferences;
}

export interface RemovedBuiltinSkillEntry {
  skillSlug: string;
  unmountedProviderIds: string[];
}

interface StaleLocalBuiltinArtifact {
  libraryPath: string;
  targetPath: string;
}

export async function removeStaleBuiltinSkills(
  input: RemoveStaleBuiltinSkillsInput
): Promise<RemovedBuiltinSkillEntry[]> {
  const currentSlugs = new Set(input.currentEntries.map((entry) => entry.slug));
  const libraryEntries = input.libraryRepo.list();
  const staleEntriesBySlug = new Map(
    libraryEntries
      .filter((entry) => entry.source === "builtin" && !currentSlugs.has(entry.slug))
      .map((entry) => [entry.slug, entry])
  );
  const staleTargetPathsBySlug = new Map<string, Set<string>>();
  const staleArtifactPaths = await listStaleBuiltinArtifactPaths(input.builtinRoot, currentSlugs);

  for (const [skillSlug, libraryPath] of staleArtifactPaths) {
    if (staleEntriesBySlug.has(skillSlug)) {
      continue;
    }
    staleEntriesBySlug.set(skillSlug, {
      slug: skillSlug,
      displayName: skillSlug,
      version: "stale",
      source: "builtin",
      libraryPath,
      installState: "installed",
      installedAt: 0,
      updatedAt: 0,
    });
  }

  const staleLocalBuiltinArtifacts = await listStaleLocalBuiltinArtifacts(
    libraryEntries,
    currentSlugs
  );
  for (const [skillSlug, artifact] of staleLocalBuiltinArtifacts) {
    if (!staleEntriesBySlug.has(skillSlug)) {
      staleEntriesBySlug.set(skillSlug, {
        slug: skillSlug,
        displayName: skillSlug,
        version: "stale",
        source: "builtin",
        libraryPath: artifact.libraryPath,
        installState: "installed",
        installedAt: 0,
        updatedAt: 0,
      });
    }

    let targetPaths = staleTargetPathsBySlug.get(skillSlug);
    if (!targetPaths) {
      targetPaths = new Set<string>();
      staleTargetPathsBySlug.set(skillSlug, targetPaths);
    }
    targetPaths.add(artifact.targetPath);
  }

  const removed: RemovedBuiltinSkillEntry[] = [];

  for (const entry of staleEntriesBySlug.values()) {
    const mounts = input.mountRepo.listBySkillSlug(entry.slug);
    const unmountedProviderIds = new Set<string>();

    for (const mount of mounts) {
      await input.mountManager.unmount(mount.providerId, mount.skillSlug).catch(() => {
        input.mountRepo.delete(mount.providerId, mount.skillSlug);
      });
      unmountedProviderIds.add(mount.providerId);
    }

    for (const provider of input.getProviderRegistry()) {
      for (const skillDir of provider.skillMountDirectories ?? []) {
        const targetPath = join(skillDir, entry.slug);
        const removedTarget = await removeStaleBuiltinTarget(
          targetPath,
          input.builtinRoot,
          entry.libraryPath
        );
        if (removedTarget) {
          unmountedProviderIds.add(provider.id);
        }
      }
    }

    for (const targetPath of staleTargetPathsBySlug.get(entry.slug) ?? []) {
      await removeStaleBuiltinTarget(targetPath, input.builtinRoot, entry.libraryPath);
    }

    input.mountRepo.deleteBySkillSlug(entry.slug);
    input.libraryRepo.delete(entry.slug);
    if (isWithinDirectory(input.builtinRoot, entry.libraryPath)) {
      await rm(entry.libraryPath, { recursive: true, force: true }).catch(() => undefined);
    }
    input.preferences.removeSkill(entry.slug);
    removed.push({ skillSlug: entry.slug, unmountedProviderIds: [...unmountedProviderIds] });
  }

  return removed;
}

function isWithinDirectory(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isWithinDirectoryOrSame(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function listStaleBuiltinArtifactPaths(
  builtinRoot: string,
  currentSlugs: Set<string>
): Promise<Map<string, string>> {
  let entries: Dirent[];
  try {
    entries = await readdir(builtinRoot, { withFileTypes: true });
  } catch {
    return new Map();
  }

  const artifacts = new Map<string, string>();
  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || currentSlugs.has(entry.name)) {
      continue;
    }

    const libraryPath = join(builtinRoot, entry.name);
    if (await hasSkillMarkdown(libraryPath)) {
      artifacts.set(entry.name, libraryPath);
    }
  }

  return artifacts;
}

async function listStaleLocalBuiltinArtifacts(
  libraryEntries: SkillLibraryEntry[],
  currentSlugs: Set<string>
): Promise<Map<string, StaleLocalBuiltinArtifact>> {
  const artifacts = new Map<string, StaleLocalBuiltinArtifact>();
  for (const entry of libraryEntries) {
    if (
      entry.source !== "installed" ||
      entry.origin !== "filesystem" ||
      currentSlugs.has(entry.slug)
    ) {
      continue;
    }

    const libraryPath = await resolveLocalBuiltinArtifactPath(entry.libraryPath, entry.slug);
    if (libraryPath) {
      artifacts.set(entry.slug, {
        libraryPath,
        targetPath: entry.libraryPath,
      });
    }
  }

  return artifacts;
}

async function resolveLocalBuiltinArtifactPath(
  discoveredPath: string,
  skillSlug: string
): Promise<string | undefined> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(discoveredPath);
  } catch {
    return undefined;
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await readlink(discoveredPath).catch(() => undefined);
    if (!linkTarget) {
      return undefined;
    }

    const resolvedTarget = resolve(dirname(discoveredPath), linkTarget);
    if (
      !isCoderStudioBuiltinArtifactPath(resolvedTarget, skillSlug) ||
      !(await hasSkillMarkdown(resolvedTarget))
    ) {
      return undefined;
    }

    return resolvedTarget;
  }

  const parentPath = dirname(discoveredPath);
  let parentStat: Awaited<ReturnType<typeof lstat>>;
  try {
    parentStat = await lstat(parentPath);
  } catch {
    return undefined;
  }

  if (!parentStat.isSymbolicLink()) {
    return undefined;
  }

  const parentLinkTarget = await readlink(parentPath).catch(() => undefined);
  if (!parentLinkTarget) {
    return undefined;
  }

  const resolvedTarget = join(resolve(dirname(parentPath), parentLinkTarget), skillSlug);
  if (
    !isCoderStudioBuiltinArtifactPath(resolvedTarget, skillSlug) ||
    !(await hasSkillMarkdown(resolvedTarget))
  ) {
    return undefined;
  }

  return resolvedTarget;
}

function isCoderStudioBuiltinArtifactPath(candidatePath: string, skillSlug: string): boolean {
  const segments = resolve(candidatePath)
    .split(/[\\/]+/)
    .filter(Boolean);
  const last = segments.length - 1;
  return (
    segments[last] === skillSlug &&
    segments[last - 1] === "builtin" &&
    segments[last - 2] === "skills" &&
    segments[last - 3] === "state"
  );
}

async function removeStaleBuiltinTarget(
  targetPath: string,
  builtinRoot: string,
  libraryPath: string
): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(targetPath);
  } catch {
    return false;
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await readlink(targetPath).catch(() => undefined);
    if (!linkTarget) {
      return false;
    }
    const resolvedTarget = resolve(dirname(targetPath), linkTarget);
    if (
      resolve(resolvedTarget) === resolve(libraryPath) ||
      isWithinDirectoryOrSame(builtinRoot, resolvedTarget)
    ) {
      await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
      return true;
    }
    return false;
  }

  if (resolve(targetPath) === resolve(libraryPath)) {
    return false;
  }

  if (await skillMarkdownMatches(targetPath, libraryPath)) {
    await rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  return false;
}

async function hasSkillMarkdown(skillPath: string): Promise<boolean> {
  try {
    await readFile(join(skillPath, "SKILL.md"), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function skillMarkdownMatches(
  leftSkillPath: string,
  rightSkillPath: string
): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([
      readFile(join(leftSkillPath, "SKILL.md"), "utf8"),
      readFile(join(rightSkillPath, "SKILL.md"), "utf8"),
    ]);
    return left === right;
  } catch {
    return false;
  }
}
