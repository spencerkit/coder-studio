import { z } from "zod";
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

      const remote = await ctx.skillsHubClient.search(args.query);
      return remote.map((item) => {
        const installed = ctx.skillLibraryRepo.get(item.slug);
        const mounts = ctx.skillMountRepo
          .listBySkillSlug(item.slug)
          .filter((entry) => entry.enabled);

        return {
          slug: item.slug,
          displayName: item.displayName,
          description: item.description,
          version: item.version,
          installed: Boolean(installed),
          installedVersion: installed?.version,
          mountedProviderIds: mounts.map((entry) => entry.providerId),
        };
      });
    }
  );

  registerCommand(
    "skills.recommend",
    z.object({
      workspaceId: z.string().trim().min(1),
      limit: z.number().int().positive().max(10).optional(),
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
      });
    }
  );

  registerCommand(
    "skills.info",
    z.object({ slug: z.string().trim().min(1) }),
    async (args, ctx) => {
      requireSkillsQuerySupport(ctx);

      const libraryEntry = ctx.skillLibraryRepo.get(args.slug);
      const remote = await ctx.skillsHubClient.info(args.slug).catch(() => undefined);

      return {
        slug: args.slug,
        displayName: remote?.name ?? libraryEntry?.displayName ?? args.slug,
        description: remote?.description ?? libraryEntry?.description,
        version: remote?.version ?? libraryEntry?.version,
        installed: Boolean(libraryEntry),
        libraryEntry,
        mounts: ctx.skillMountRepo.listBySkillSlug(args.slug),
      };
    }
  );
}
