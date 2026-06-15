import { z } from "zod";
import { registerCommand } from "../../ws/dispatch.js";
import {
  broadcastSkillLibraryChanged,
  hasSyncChanges,
  requireBuiltinSkillSyncSupport,
} from "./shared.js";

export function registerBuiltinSkillCommands(): void {
  registerCommand("skills.builtin.sync", z.object({}), async (_args, ctx) => {
    requireBuiltinSkillSyncSupport(ctx);
    const result = await ctx.builtinSkillSyncMgr.sync();
    if (hasSyncChanges(result)) {
      broadcastSkillLibraryChanged(ctx, {
        reason: "builtin_sync",
        removed: result.removed ?? [],
      });
    }
    return result;
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
      const result = await ctx.builtinSkillSyncMgr.sync();
      broadcastSkillLibraryChanged(ctx, {
        reason: "builtin_mount_setting_changed",
        providerId: args.providerId,
        skillSlug: args.skillSlug,
        enabled: args.enabled,
        removed: result.removed ?? [],
      });
      return result;
    }
  );
}
