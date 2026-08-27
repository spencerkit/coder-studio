import { z } from "zod";
import { createCoderStudioSkillManager } from "../../skills/host/create-coder-studio-skill-manager.js";
import { registerCommand } from "../../ws/dispatch.js";
import { requireSkillHealthSupport, requireSkillTargetSupport } from "./shared.js";

export function registerSkillHealthCommands(): void {
  registerCommand("skills.targets.list", z.object({}), async (_args, ctx) => {
    requireSkillTargetSupport(ctx);
    requireSkillHealthSupport(ctx);
    return createCoderStudioSkillManager(ctx).listTargets();
  });

  registerCommand("skills.health.scan", z.object({}), async (_args, ctx) => {
    requireSkillHealthSupport(ctx);
    requireSkillTargetSupport(ctx);

    return createCoderStudioSkillManager(ctx).scan();
  });
}
