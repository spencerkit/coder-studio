import { rm } from "node:fs/promises";
import { z } from "zod";
import { registerCommand } from "../../ws/dispatch.js";
import {
  broadcastSkillLibraryChanged,
  requireSkillHealthSupport,
  requireSkillMountSupport,
  requireSkillsQuerySupport,
  requireSkillTargetSupport,
} from "./shared.js";

export function registerSkillMountCommands(): void {
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
      broadcastSkillLibraryChanged(ctx, {
        reason: "mounted",
        providerId: args.providerId,
        skillSlug: args.skillSlug,
      });
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
      broadcastSkillLibraryChanged(ctx, {
        reason: "unmounted",
        providerId: args.providerId,
        skillSlug: args.skillSlug,
      });
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
      if (libraryEntry?.source === "builtin") {
        throw {
          code: "skill_uninstall_unavailable",
          message: `Built-in skills cannot be uninstalled: ${args.slug}`,
        };
      }

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
      broadcastSkillLibraryChanged(ctx, {
        reason: "uninstalled",
        slug: args.slug,
      });
      return { deleted: true, slug: args.slug };
    }
  );

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
      broadcastSkillLibraryChanged(ctx, {
        reason: "repaired",
        providerId: args.providerId,
        skillSlug: args.skillSlug,
      });
      return scanned;
    }
  );
}
