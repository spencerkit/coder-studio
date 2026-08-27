import { z } from "zod";
import { createCoderStudioSkillManager } from "../../skills/host/create-coder-studio-skill-manager.js";
import { registerCommand } from "../../ws/dispatch.js";
import { requireSkillsQuerySupport, requireSkillVersionCheckSupport } from "./shared.js";

export function registerSkillLibraryCommands(): void {
  registerCommand("skills.library.list", z.object({}), async (_args, ctx) => {
    requireSkillsQuerySupport(ctx);
    return createCoderStudioSkillManager(ctx).listSkills();
  });

  registerCommand("skills.versions.check", z.object({}), async (_args, ctx) => {
    requireSkillVersionCheckSupport(ctx);
    return createCoderStudioSkillManager(ctx).checkVersions();
  });
}
