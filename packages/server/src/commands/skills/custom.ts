import { z } from "zod";
import { createCustomSkill, slugifySkillName } from "../../skills/custom-skill.js";
import { registerCommand } from "../../ws/dispatch.js";
import { broadcastSkillLibraryChanged, requireSkillsQuerySupport } from "./shared.js";

export function registerCustomSkillCommands(): void {
  registerCommand(
    "skills.custom.create",
    z.object({
      name: z.string().trim().min(1),
    }),
    async (args, ctx) => {
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
    }
  );
}
