import { z } from "zod";
import { buildSessionReviewSummary, getSessionReviewDiff } from "../session-review/review.js";
import { registerCommand } from "../ws/dispatch.js";

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
    workspaceMgr: {
      get(workspaceId: string): { id: string; path: string } | undefined;
    };
  },
  workspaceId: string
): { id: string; path: string } {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }

  return workspace;
}

registerCommand(
  "sessionReview.summary",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
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
  }
);

registerCommand(
  "sessionReview.diff",
  z.object({
    sessionId: z.string(),
    path: z.string().trim().min(1),
  }),
  async (args, ctx) => {
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
  }
);
