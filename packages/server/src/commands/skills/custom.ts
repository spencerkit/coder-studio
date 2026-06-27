import { z } from "zod";
import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import { createCustomSkill, slugifySkillName } from "../../skills/custom-skill.js";
import {
  broadcastSkillLibraryChanged,
  requireSkillsQuerySupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

export function registerCustomSkillCommands(): void {
  registerRuntimeCommand(
    "skills.custom.create",
    skillRuntimeTargetSchema.extend({
      name: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        requireSkillsQuerySupport(ctx);

        const rootDir = ctx.skillLibraryRepo.getCustomSkillRoot();
        if (!rootDir) {
          throw {
            code: "skill_create_unavailable",
            message: "No custom skill root is configured",
          };
        }

        const existing = ctx.skillLibraryRepo.get(slugifySkillName(args.name));
        if (existing) {
          throw {
            code: "skill_slug_conflict",
            message: `A skill with slug ${existing.slug} already exists`,
          };
        }

        const slug = slugifySkillName(args.name);
        for (const entry of ctx.skillLibraryRepo.list()) {
          if (entry.slug === slug) {
            throw {
              code: "skill_slug_conflict",
              message: `A skill with slug ${entry.slug} already exists`,
            };
          }
        }

        const entry = await createCustomSkill({
          rootDir,
          name: args.name,
        });

        ctx.skillLibraryRepo.set(entry);
        broadcastSkillLibraryChanged(ctx, {
          reason: "custom_created",
          slug: entry.slug,
        });
        return entry;
      },
    }
  );
}
