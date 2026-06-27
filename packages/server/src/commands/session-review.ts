import { z } from "zod";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { buildSessionReviewSummary, getSessionReviewDiff } from "../session-review/review.js";

function requireSessionMetadataRepo(ctx: { sessionMetadataRepo?: unknown }): asserts ctx is {
  sessionMetadataRepo: NonNullable<typeof ctx.sessionMetadataRepo>;
} {
  if (!ctx.sessionMetadataRepo) {
    throw {
      code: "session_metadata_unavailable",
      message: "Session metadata repository is not configured",
    };
  }
}

function requireWorkspace(
  ctx: {
    workspaceLookup: {
      get(workspaceId: string): { id: string; path: string } | undefined;
    };
  },
  workspaceId: string
): { id: string; path: string } {
  const workspace = ctx.workspaceLookup.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }

  return workspace;
}

registerRuntimeCommand(
  "sessionReview.summary",
  z.object({
    sessionId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "session", sessionId: args.sessionId }),
    handler: async (args, ctx) => {
      requireSessionMetadataRepo(ctx);
      const metadata = ctx.sessionMetadataRepo.get(args.sessionId);
      if (!metadata) {
        throw {
          code: "session_metadata_not_found",
          message: `Session metadata not found: ${args.sessionId}`,
        };
      }

      const workspace = requireWorkspace(ctx, metadata.workspaceId);
      return buildSessionReviewSummary({
        sessionId: args.sessionId,
        workspacePath: workspace.path,
        metadataRepo: ctx.sessionMetadataRepo,
      });
    },
  }
);

registerRuntimeCommand(
  "sessionReview.diff",
  z.object({
    sessionId: z.string(),
    path: z.string().trim().min(1),
  }),
  {
    resolveTarget: (args) => ({ kind: "session", sessionId: args.sessionId }),
    handler: async (args, ctx) => {
      requireSessionMetadataRepo(ctx);
      const metadata = ctx.sessionMetadataRepo.get(args.sessionId);
      if (!metadata) {
        throw {
          code: "session_metadata_not_found",
          message: `Session metadata not found: ${args.sessionId}`,
        };
      }

      const workspace = requireWorkspace(ctx, metadata.workspaceId);
      return {
        path: args.path,
        diff: await getSessionReviewDiff({
          sessionId: args.sessionId,
          workspacePath: workspace.path,
          metadataRepo: ctx.sessionMetadataRepo,
          path: args.path,
        }),
      };
    },
  }
);
