import { z } from "zod";
import { createCoderStudioSkillManager } from "../../skills/host/create-coder-studio-skill-manager.js";
import { registerCommand } from "../../ws/dispatch.js";
import { requireSkillInstallSupport } from "./shared.js";

export function registerSkillInstallCommands(): void {
  registerCommand(
    "skills.install.start",
    z.object({
      slug: z.string().trim().min(1),
      registryRef: z.string().trim().min(1).optional(),
    }),
    async (args, ctx) => {
      requireSkillInstallSupport(ctx);
      return createCoderStudioSkillManager(ctx).startInstall(args.slug, args.registryRef);
    }
  );

  registerCommand(
    "skills.update.start",
    z.object({ slug: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillInstallSupport(ctx);
      if (!ctx.skillLibraryRepo) {
        throw { code: "skills_unavailable", message: "Skill management is not configured" };
      }

      return createCoderStudioSkillManager(ctx).startUpdate(args.slug);
    }
  );

  registerCommand(
    "skills.install.get",
    z.object({ jobId: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillInstallSupport(ctx);
      return createCoderStudioSkillManager(ctx).getInstallJob(args.jobId);
    }
  );
}
