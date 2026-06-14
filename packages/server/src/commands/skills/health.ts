import { z } from "zod";
import { registerCommand } from "../../ws/dispatch.js";
import { listTargets, requireSkillHealthSupport, requireSkillTargetSupport } from "./shared.js";

export function registerSkillHealthCommands(): void {
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
}
