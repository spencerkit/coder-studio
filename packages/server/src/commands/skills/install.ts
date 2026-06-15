import { z } from "zod";
import { registerCommand } from "../../ws/dispatch.js";
import { requireSkillInstallSupport } from "./shared.js";

export function registerSkillInstallCommands(): void {
  registerCommand(
    "skills.install.start",
    z.object({ slug: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillInstallSupport(ctx);
      return ctx.skillInstallMgr.start(args.slug);
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

      const entry = ctx.skillLibraryRepo.get(args.slug);
      if (!entry || entry.source !== "skillhub" || entry.installState !== "installed") {
        throw {
          code: "skill_update_unavailable",
          message: `Only installed Skill Hub skills can be updated: ${args.slug}`,
        };
      }

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
}
