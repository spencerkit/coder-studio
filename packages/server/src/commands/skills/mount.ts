import { z } from "zod";
import { createCoderStudioSkillManager } from "../../skills/host/create-coder-studio-skill-manager.js";
import { registerCommand } from "../../ws/dispatch.js";
import {
  requireSkillHealthSupport,
  requireSkillMountSupport,
  requireSkillsQuerySupport,
  requireSkillTargetSupport,
} from "./shared.js";

export function registerSkillMountCommands(): void {
  registerCommand(
    "skills.mount",
    z.object({
      providerId: z.string().trim().min(1),
      skillSlug: z.string().trim().min(1),
      enabled: z.boolean().default(true),
    }),
    async (args, ctx) => {
      requireSkillMountSupport(ctx);
      requireSkillHealthSupport(ctx);
      requireSkillTargetSupport(ctx);

      return createCoderStudioSkillManager(ctx).sync(args);
    }
  );

  registerCommand(
    "skills.unmount",
    z.object({
      providerId: z.string().trim().min(1),
      skillSlug: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      requireSkillMountSupport(ctx);
      await createCoderStudioSkillManager(ctx).unsync(args.providerId, args.skillSlug);
      return { ok: true };
    }
  );

  registerCommand(
    "skills.uninstall",
    z.object({
      slug: z.string().trim().min(1),
      force: z.boolean().optional(),
    }),
    async (args, ctx) => {
      requireSkillsQuerySupport(ctx);
      requireSkillMountSupport(ctx);
      return createCoderStudioSkillManager(ctx).remove(args.slug, args.force);
    }
  );

  registerCommand(
    "skills.repair",
    z.object({
      providerId: z.string().trim().min(1),
      skillSlug: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      requireSkillMountSupport(ctx);
      requireSkillHealthSupport(ctx);
      requireSkillTargetSupport(ctx);

      return createCoderStudioSkillManager(ctx).repair(args.providerId, args.skillSlug);
    }
  );
}
