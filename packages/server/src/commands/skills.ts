import { rm } from "node:fs/promises";
import { z } from "zod";
import { buildAgentSkillTargets } from "../skills/target-registry.js";
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";

function requireSkillsQuerySupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillsHubClient: NonNullable<CommandContext["skillsHubClient"]>;
  skillLibraryRepo: NonNullable<CommandContext["skillLibraryRepo"]>;
  skillMountRepo: NonNullable<CommandContext["skillMountRepo"]>;
} {
  if (!ctx.skillsHubClient || !ctx.skillLibraryRepo || !ctx.skillMountRepo) {
    throw { code: "skills_unavailable", message: "Skill management is not configured" };
  }
}

function requireSkillInstallSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillInstallMgr: NonNullable<CommandContext["skillInstallMgr"]>;
} {
  if (!ctx.skillInstallMgr) {
    throw {
      code: "skill_install_unavailable",
      message: "Skill install manager is not configured",
    };
  }
}

function requireSkillMountSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillMountMgr: NonNullable<CommandContext["skillMountMgr"]>;
} {
  if (!ctx.skillMountMgr) {
    throw {
      code: "skill_mount_unavailable",
      message: "Skill mount manager is not configured",
    };
  }
}

function requireSkillHealthSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillHealthMgr: NonNullable<CommandContext["skillHealthMgr"]>;
} {
  if (!ctx.skillHealthMgr) {
    throw {
      code: "skill_health_unavailable",
      message: "Skill health manager is not configured",
    };
  }
}

function requireSkillTargetSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  skillMountRepo: NonNullable<CommandContext["skillMountRepo"]>;
} {
  if (!ctx.skillMountRepo) {
    throw {
      code: "skill_targets_unavailable",
      message: "Skill target settings are not configured",
    };
  }
}

function requireBuiltinSkillSyncSupport(ctx: CommandContext): asserts ctx is CommandContext & {
  builtinSkillSyncMgr: NonNullable<CommandContext["builtinSkillSyncMgr"]>;
} {
  if (!ctx.builtinSkillSyncMgr) {
    throw {
      code: "builtin_skills_unavailable",
      message: "Built-in skill sync is not configured",
    };
  }
}

async function listTargets(ctx: CommandContext) {
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

registerCommand(
  "skills.search",
  z.object({ query: z.string().trim().min(1) }),
  async (args, ctx) => {
    requireSkillsQuerySupport(ctx);

    const remote = await ctx.skillsHubClient.search(args.query);
    return remote.map((item) => {
      const installed = ctx.skillLibraryRepo.get(item.slug);
      const mounts = ctx.skillMountRepo.listBySkillSlug(item.slug).filter((entry) => entry.enabled);

      return {
        slug: item.slug,
        displayName: item.displayName,
        description: item.description,
        installed: Boolean(installed),
        installedVersion: installed?.version,
        mountedProviderIds: mounts.map((entry) => entry.providerId),
      };
    });
  }
);

registerCommand("skills.info", z.object({ slug: z.string().trim().min(1) }), async (args, ctx) => {
  requireSkillsQuerySupport(ctx);

  const libraryEntry = ctx.skillLibraryRepo.get(args.slug);
  const remote = await ctx.skillsHubClient.info(args.slug).catch(() => undefined);

  return {
    slug: args.slug,
    displayName: remote?.name ?? libraryEntry?.displayName ?? args.slug,
    description: remote?.description ?? libraryEntry?.description,
    version: remote?.version ?? libraryEntry?.version,
    installed: Boolean(libraryEntry),
    libraryEntry,
    mounts: ctx.skillMountRepo.listBySkillSlug(args.slug),
  };
});

registerCommand("skills.library.list", z.object({}), async (_args, ctx) => {
  requireSkillsQuerySupport(ctx);

  const skillLibraryRepo = ctx.skillLibraryRepo;
  const skillMountRepo = ctx.skillMountRepo;

  return skillLibraryRepo.list().map((entry) => {
    const mounts = skillMountRepo.listBySkillSlug(entry.slug).filter((item) => item.enabled);
    const errors = mounts.filter((item) => item.status === "failed" || item.status === "stale");

    return {
      ...entry,
      mountedProviderIds: mounts.map((item) => item.providerId),
      mountStatus:
        errors.length > 0
          ? "error"
          : mounts.length === 0
            ? "unmounted"
            : mounts.length === 1
              ? "partially_mounted"
              : "fully_mounted",
      errorCount: errors.length,
    };
  });
});

registerCommand("skills.builtin.sync", z.object({}), async (_args, ctx) => {
  requireBuiltinSkillSyncSupport(ctx);
  return ctx.builtinSkillSyncMgr.sync();
});

registerCommand(
  "skills.builtin.setMountEnabled",
  z.object({
    providerId: z.string().trim().min(1),
    skillSlug: z.string().trim().min(1),
    enabled: z.boolean(),
  }),
  async (args, ctx) => {
    requireBuiltinSkillSyncSupport(ctx);
    ctx.builtinSkillSyncMgr.setMountEnabled(args.providerId, args.skillSlug, args.enabled);
    return ctx.builtinSkillSyncMgr.sync();
  }
);

registerCommand(
  "skills.install.start",
  z.object({ slug: z.string().trim().min(1) }),
  async (args, ctx) => {
    requireSkillInstallSupport(ctx);
    return ctx.skillInstallMgr.start(args.slug);
  }
);

registerCommand(
  "skills.install.get",
  z.object({ jobId: z.string().trim().min(1) }),
  async (args, ctx) => {
    requireSkillInstallSupport(ctx);
    const job = ctx.skillInstallMgr.get(args.jobId);
    if (!job) {
      throw {
        code: "skill_install_job_not_found",
        message: `Install job not found: ${args.jobId}`,
      };
    }

    return job;
  }
);

registerCommand(
  "skills.mount",
  z.object({
    providerId: z.string().trim().min(1),
    skillSlug: z.string().trim().min(1),
    enabled: z.boolean().default(true),
  }),
  async (args, ctx) => {
    requireSkillMountSupport(ctx);
    requireSkillHealthSupport(ctx);
    requireSkillTargetSupport(ctx);

    const relation = await ctx.skillMountMgr.mount(args);
    const scanned = await ctx.skillHealthMgr.scanMount(relation);
    ctx.skillMountRepo.upsert(scanned);
    return scanned;
  }
);

registerCommand(
  "skills.unmount",
  z.object({
    providerId: z.string().trim().min(1),
    skillSlug: z.string().trim().min(1),
  }),
  async (args, ctx) => {
    requireSkillMountSupport(ctx);
    await ctx.skillMountMgr.unmount(args.providerId, args.skillSlug);
    return { ok: true };
  }
);

registerCommand(
  "skills.uninstall",
  z.object({
    slug: z.string().trim().min(1),
    force: z.boolean().optional(),
  }),
  async (args, ctx) => {
    requireSkillsQuerySupport(ctx);
    requireSkillMountSupport(ctx);

    const libraryEntry = ctx.skillLibraryRepo.get(args.slug);
    const mounts = ctx.skillMountRepo.listBySkillSlug(args.slug);
    const enabledMounts = mounts.filter((entry) => entry.enabled);
    if (enabledMounts.length > 0 && !args.force) {
      throw {
        code: "skill_uninstall_blocked",
        message: `Skill still mounted: ${args.slug}`,
        details: enabledMounts.map((entry) => entry.providerId),
      };
    }

    if (args.force) {
      for (const mount of mounts) {
        await ctx.skillMountMgr.unmount(mount.providerId, mount.skillSlug).catch(() => undefined);
      }
    }

    ctx.skillMountRepo.deleteBySkillSlug(args.slug);
    ctx.skillLibraryRepo.delete(args.slug);
    if (libraryEntry?.libraryPath) {
      await rm(libraryEntry.libraryPath, { recursive: true, force: true }).catch(() => undefined);
    }
    return { deleted: true, slug: args.slug };
  }
);

registerCommand("skills.targets.list", z.object({}), async (_args, ctx) => {
  return listTargets(ctx);
});

registerCommand("skills.health.scan", z.object({}), async (_args, ctx) => {
  requireSkillHealthSupport(ctx);
  requireSkillTargetSupport(ctx);

  const discoveredMounts = await ctx.skillHealthMgr.discoverMounts(ctx.skillMountRepo.list());
  for (const relation of discoveredMounts) {
    ctx.skillMountRepo.upsert(relation);
  }

  const scannedMounts = await Promise.all(
    ctx.skillMountRepo.list().map((relation) => ctx.skillHealthMgr.scanMount(relation))
  );
  for (const relation of scannedMounts) {
    ctx.skillMountRepo.upsert(relation);
  }

  return {
    targets: await listTargets(ctx),
    mounts: scannedMounts,
  };
});

registerCommand(
  "skills.repair",
  z.object({
    providerId: z.string().trim().min(1),
    skillSlug: z.string().trim().min(1),
  }),
  async (args, ctx) => {
    requireSkillMountSupport(ctx);
    requireSkillHealthSupport(ctx);
    requireSkillTargetSupport(ctx);

    const existing = ctx.skillMountRepo.get(args.providerId, args.skillSlug);
    if (!existing) {
      throw {
        code: "skill_mount_not_found",
        message: `Mount not found for ${args.providerId}:${args.skillSlug}`,
      };
    }

    const relation = await ctx.skillMountMgr.mount({
      providerId: args.providerId,
      skillSlug: args.skillSlug,
      enabled: existing.enabled,
    });
    const scanned = await ctx.skillHealthMgr.scanMount(relation);
    ctx.skillMountRepo.upsert(scanned);
    return scanned;
  }
);
