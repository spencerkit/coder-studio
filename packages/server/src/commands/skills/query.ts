import { z } from "zod";
import { createCoderStudioSkillManager } from "../../skills/host/create-coder-studio-skill-manager.js";
import { buildSkillRecommendations } from "../../skills/recommendation.js";
import { inspectWorkspaceIntelligence } from "../../workspace/intelligence.js";
import { registerCommand } from "../../ws/dispatch.js";
import { requireSkillsQuerySupport } from "./shared.js";

export function registerSkillQueryCommands(): void {
  registerCommand(
    "skills.search",
    z.object({ query: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillsQuerySupport(ctx);
      return createCoderStudioSkillManager(ctx).searchSkills(args.query);
    }
  );

  registerCommand(
    "skills.recommend",
    z.object({
      workspaceId: z.string().trim().min(1),
      limit: z.number().int().positive().max(20).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async (args, ctx) => {
      requireSkillsQuerySupport(ctx);

      const workspace = ctx.workspaceMgr.get(args.workspaceId);
      if (!workspace) {
        throw {
          code: "workspace_not_found",
          message: `Workspace not found: ${args.workspaceId}`,
        };
      }

      const intelligence = await inspectWorkspaceIntelligence({
        workspaceId: workspace.id,
        rootPath: workspace.path,
      });

      return buildSkillRecommendations({
        intelligence,
        search: (query) => ctx.skillsHubClient.search(query),
        isInstalled: (slug) => Boolean(ctx.skillLibraryRepo.get(slug)),
        limit: args.limit,
        offset: args.offset,
      });
    }
  );

  registerCommand(
    "skills.info",
    z.object({ slug: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillsQuerySupport(ctx);
      return createCoderStudioSkillManager(ctx).getSkillInfo(args.slug);
    }
  );
}
