import { Topics } from "@coder-studio/core";
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
