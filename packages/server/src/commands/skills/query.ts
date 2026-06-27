import { z } from "zod";
import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import { buildSkillRecommendations } from "../../skills/recommendation.js";
import { inspectWorkspaceIntelligence } from "../../workspace/intelligence.js";
import {
  requireSkillsQuerySupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

export function registerSkillQueryCommands(): void {
  registerRuntimeCommand(
    "skills.search",
    skillRuntimeTargetSchema.extend({
      query: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
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
      },
    }
  );

  registerRuntimeCommand(
    "skills.recommend",
    z.object({
      workspaceId: z.string().trim().min(1),
      runtimeId: z.string().optional(),
      limit: z.number().int().positive().max(20).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    {
      resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
      handler: async (args, ctx) => {
        requireSkillsQuerySupport(ctx);

        const workspace = ctx.workspaceLookup.get(args.workspaceId);
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
      },
    }
  );

  registerRuntimeCommand(
    "skills.info",
    skillRuntimeTargetSchema.extend({
      slug: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
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
      },
    }
  );
}
