import { z } from "zod";
import {
  buildDiffContextPackage,
  buildFileContextPackage,
  buildProjectSummaryContextPackage,
  buildSessionReviewContextPackage,
} from "../agent-context/context-package.js";
import { registerCommand } from "../ws/dispatch.js";

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

function getSessionWorkspace(
  ctx: {
    workspaceMgr: {
      get(workspaceId: string): { id: string; path: string } | undefined;
    };
    sessionMetadataRepo: {
      get(sessionId: string):
        | {
            sessionId: string;
            workspaceId: string;
          }
        | undefined;
    };
  },
  sessionId: string
): {
  metadata: { sessionId: string; workspaceId: string };
  workspace: { id: string; path: string };
} {
  const metadata = ctx.sessionMetadataRepo.get(sessionId);
  if (!metadata) {
    throw {
      code: "session_metadata_not_found",
      message: `Session metadata not found: ${sessionId}`,
    };
  }

  return {
    metadata,
    workspace: requireWorkspace(ctx, metadata.workspaceId),
  };
}

registerCommand(
  "agentContext.fromFile",
  z.object({
    workspaceId: z.string(),
    path: z.string().trim().min(1),
  }),
  async (args, ctx) => {
    const workspace = requireWorkspace(ctx, args.workspaceId);
    return buildFileContextPackage({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      path: args.path,
    });
  }
);

registerCommand(
  "agentContext.fromDiff",
  z.object({
    sessionId: z.string(),
    path: z.string().trim().min(1),
  }),
  async (args, ctx) => {
    requireSessionMetadataRepo(ctx);
    const { workspace } = getSessionWorkspace(ctx, args.sessionId);
    return buildDiffContextPackage({
      sessionId: args.sessionId,
      path: args.path,
      workspacePath: workspace.path,
      metadataRepo: ctx.sessionMetadataRepo,
    });
  }
);

registerCommand(
  "agentContext.fromProjectSummary",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = requireWorkspace(ctx, args.workspaceId);
    return buildProjectSummaryContextPackage({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
    });
  }
);

registerCommand(
  "agentContext.fromSessionReview",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    requireSessionMetadataRepo(ctx);
    const { workspace } = getSessionWorkspace(ctx, args.sessionId);
    return buildSessionReviewContextPackage({
      sessionId: args.sessionId,
      workspacePath: workspace.path,
      metadataRepo: ctx.sessionMetadataRepo,
    });
  }
);
