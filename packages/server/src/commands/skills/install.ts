import { z } from "zod";
import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import {
  requireSkillInstallSupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

function canInstallFromSkillHub(
  entry:
    | {
        slug: string;
        source: "builtin" | "installed" | "custom";
        origin?: "builtin" | "skillhub" | "filesystem";
      }
    | undefined
): boolean {
  return !entry || (entry.source === "installed" && entry.origin === "skillhub");
}

export function registerSkillInstallCommands(): void {
  registerRuntimeCommand(
    "skills.install.start",
    skillRuntimeTargetSchema.extend({
      slug: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        requireSkillInstallSupport(ctx);
        const existing = ctx.skillLibraryRepo?.get(args.slug);
        if (!canInstallFromSkillHub(existing)) {
          throw {
            code: "skill_slug_conflict",
            message: `A skill with slug ${args.slug} already exists`,
          };
        }
        return ctx.skillInstallMgr.start(args.slug);
      },
    }
  );

  registerRuntimeCommand(
    "skills.update.start",
    skillRuntimeTargetSchema.extend({
      slug: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        requireSkillInstallSupport(ctx);
        if (!ctx.skillLibraryRepo) {
          throw { code: "skills_unavailable", message: "Skill management is not configured" };
        }

        const entry = ctx.skillLibraryRepo.get(args.slug);
        if (
          !entry ||
          entry.source !== "installed" ||
          entry.origin !== "skillhub" ||
          entry.installState !== "installed"
        ) {
          throw {
            code: "skill_update_unavailable",
            message: `Only installed Skill Hub skills can be updated: ${args.slug}`,
          };
        }

        return ctx.skillInstallMgr.start(args.slug);
      },
    }
  );

  registerRuntimeCommand(
    "skills.install.get",
    skillRuntimeTargetSchema.extend({
      jobId: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        requireSkillInstallSupport(ctx);
        const job = ctx.skillInstallMgr.get(args.jobId);
        if (!job) {
          throw {
            code: "skill_install_job_not_found",
            message: `Install job not found: ${args.jobId}`,
          };
        }

        return job;
      },
    }
  );
}
