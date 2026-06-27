import { z } from "zod";
import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import {
  broadcastSkillLibraryChanged,
  hasSyncChanges,
  requireBuiltinSkillSyncSupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

export function registerBuiltinSkillCommands(): void {
  registerRuntimeCommand("skills.builtin.sync", skillRuntimeTargetSchema, {
    resolveTarget: (args) => resolveSkillRuntimeTarget(args),
    handler: async (_args, ctx) => {
      requireBuiltinSkillSyncSupport(ctx);
      const result = await ctx.builtinSkillSyncMgr.sync();
      if (hasSyncChanges(result)) {
        broadcastSkillLibraryChanged(ctx, {
          reason: "builtin_sync",
          removed: result.removed ?? [],
        });
      }
      return result;
    },
  });

  registerRuntimeCommand(
    "skills.builtin.setMountEnabled",
    skillRuntimeTargetSchema.extend({
      providerId: z.string().trim().min(1),
      skillSlug: z.string().trim().min(1),
      enabled: z.boolean(),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
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
      },
    }
  );
}
