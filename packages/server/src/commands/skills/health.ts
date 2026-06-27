import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import {
  listTargets,
  requireSkillHealthSupport,
  requireSkillTargetSupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

export function registerSkillHealthCommands(): void {
  registerRuntimeCommand("skills.targets.list", skillRuntimeTargetSchema, {
    resolveTarget: (args) => resolveSkillRuntimeTarget(args),
    handler: async (_args, ctx) => {
      return listTargets(ctx);
    },
  });

  registerRuntimeCommand("skills.health.scan", skillRuntimeTargetSchema, {
    resolveTarget: (args) => resolveSkillRuntimeTarget(args),
    handler: async (_args, ctx) => {
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
    },
  });
}
