import { type SkillLibraryEntry, type SkillVersionCheckEntry, Topics } from "@coder-studio/core";
import { buildAgentSkillTargets } from "../../skills/target-registry.js";
import type { CommandContext } from "../../ws/dispatch.js";

export function requireSkillsQuerySupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillsHubClient: NonNullable<CommandContext["skillsHubClient"]>;
  skillLibraryRepo: NonNullable<CommandContext["skillLibraryRepo"]>;
  skillMountRepo: NonNullable<CommandContext["skillMountRepo"]>;
} {
  if (!ctx.skillsHubClient || !ctx.skillLibraryRepo || !ctx.skillMountRepo) {
    throw { code: "skills_unavailable", message: "Skill management is not configured" };
  }
}

export function requireSkillVersionCheckSupport(
  ctx: CommandContext
): asserts ctx is CommandContext & {
  skillsHubClient: NonNullable<CommandContext["skillsHubClient"]>;
  skillLibraryRepo: NonNullable<CommandContext["skillLibraryRepo"]>;
} {
  if (!ctx.skillsHubClient || !ctx.skillLibraryRepo) {
    throw { code: "skills_unavailable", message: "Skill management is not configured" };
  }
}

export function requireSkillInstallSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillInstallMgr: NonNullable<CommandContext["skillInstallMgr"]>;
} {
  if (!ctx.skillInstallMgr) {
    throw {
      code: "skill_install_unavailable",
      message: "Skill install manager is not configured",
    };
  }
}

export function requireSkillMountSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillMountMgr: NonNullable<CommandContext["skillMountMgr"]>;
} {
  if (!ctx.skillMountMgr) {
    throw {
      code: "skill_mount_unavailable",
      message: "Skill mount manager is not configured",
    };
  }
}

export function requireSkillHealthSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillHealthMgr: NonNullable<CommandContext["skillHealthMgr"]>;
} {
  if (!ctx.skillHealthMgr) {
    throw {
      code: "skill_health_unavailable",
      message: "Skill health manager is not configured",
    };
  }
}

export function requireSkillTargetSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillMountRepo: NonNullable<CommandContext["skillMountRepo"]>;
} {
  if (!ctx.skillMountRepo) {
    throw {
      code: "skill_targets_unavailable",
      message: "Skill target settings are not configured",
    };
  }
}

export function requireBuiltinSkillSyncSupport(
  ctx: CommandContext
): asserts ctx is CommandContext & {
  builtinSkillSyncMgr: NonNullable<CommandContext["builtinSkillSyncMgr"]>;
} {
  if (!ctx.builtinSkillSyncMgr) {
    throw {
      code: "builtin_skills_unavailable",
      message: "Built-in skill sync is not configured",
    };
  }
}

export function broadcastSkillLibraryChanged(
  ctx: CommandContext,
  payload: Record<string, unknown>
): void {
  if (typeof ctx.broadcaster.broadcast !== "function") {
    return;
  }

  ctx.broadcaster.broadcast(Topics.skillLibraryChanged, {
    ...payload,
    changedAt: Date.now(),
  });
}

export function hasSyncChanges(result: {
  libraryEntries?: unknown[];
  mounted?: unknown[];
  removed?: unknown[];
}): boolean {
  return (
    (result.removed?.length ?? 0) > 0 ||
    (result.mounted?.length ?? 0) > 0 ||
    (result.libraryEntries?.length ?? 0) > 0
  );
}

export async function listTargets(ctx: CommandContext) {
  requireSkillTargetSupport(ctx);
  requireSkillHealthSupport(ctx);

  const health = await ctx.skillHealthMgr.listTargetHealth();
  return buildAgentSkillTargets({
    providers: ctx.providerRegistry,
    resolvedSkillDirByProviderId: Object.fromEntries(
      ctx.providerRegistry.map((provider) => [provider.id, provider.skillMountDirectories?.[0]])
    ),
    mountCountsByProviderId: ctx.skillMountRepo.countsByProviderId(),
    targetHealthByProviderId: health,
  });
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v(?=\d)/i, "")
    .split(".")
    .map((segment) => {
      const match = segment.match(/^(\d+)/);
      return match ? Number.parseInt(match[1]!, 10) : 0;
    });
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

export async function checkSkillHubVersion(
  entry: SkillLibraryEntry,
  ctx: CommandContext & {
    skillsHubClient: NonNullable<CommandContext["skillsHubClient"]>;
  }
): Promise<SkillVersionCheckEntry> {
  try {
    const remote = await ctx.skillsHubClient.info(entry.slug);
    const latestVersion = remote.version?.trim();
    if (!latestVersion) {
      return {
        slug: entry.slug,
        currentVersion: entry.version,
        status: "unknown",
      };
    }

    return {
      slug: entry.slug,
      currentVersion: entry.version,
      latestVersion,
      status: compareVersions(latestVersion, entry.version) > 0 ? "update_available" : "up_to_date",
    };
  } catch (error) {
    return {
      slug: entry.slug,
      currentVersion: entry.version,
      status: "error",
      error: error instanceof Error ? error.message : "Version check failed",
    };
  }
}
