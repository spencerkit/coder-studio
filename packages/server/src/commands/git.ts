/**
 * Git Commands
 */

import { z } from "zod";
import {
  commitChanges,
  discardChanges,
  GitAuthError,
  getGitCommitDiff,
  getGitHistory,
  getGitStatus,
  runGitCheckout,
  runGitCreateBranch,
  runGitFetch,
  runGitListBranches,
  runGitPull,
  runGitPush,
  stageFiles,
  unstageFiles,
} from "../git/cli.js";
import { getFileDiff } from "../git/diff.js";
import { getGitCommitDetail, getGitCommitFileDiff } from "../git/history.js";
import { applyGitHunkOperation } from "../git/hunk-operations.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import { emitGitStateChanged } from "./git-events.js";

const gitHttpAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});
const gitCommitRevisionSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{7,64}$/, "Invalid git commit revision");

const GIT_BACKGROUND_FETCH_TIMEOUT_MS = 30 * 1000;

function debugGitHistoryCommand(message: string, details?: Record<string, unknown>) {
  if (process.env.CODER_STUDIO_DEBUG_GIT_HISTORY !== "1") {
    return;
  }

  console.log("[git-history]", message, details);
}

function getWorkspaceOrThrow(ctx: RuntimeCommandContext, workspaceId: string) {
  const workspace = ctx.workspaceLookup.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }
  return workspace;
}

async function runGitNetworkOperation<T>(
  ctx: RuntimeCommandContext,
  workspaceId: string,
  op: () => Promise<T>
): Promise<T> {
  const autoFetch = (
    ctx as unknown as {
      autoFetch?: { runExclusive?<R>(workspaceId: string, op: () => Promise<R>): Promise<R> };
    }
  ).autoFetch;
  if (!autoFetch?.runExclusive) {
    return op();
  }

  return autoFetch.runExclusive(workspaceId, op);
}

function workspaceTarget(workspaceId: string) {
  return { kind: "workspace" as const, workspaceId };
}

registerRuntimeCommand(
  "git.status",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return getGitStatus(workspace.path);
    },
  }
);

registerRuntimeCommand(
  "git.stage",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await stageFiles(workspace.path, args.paths);
      emitGitStateChanged(ctx as never, args.workspaceId);
      return {};
    },
  }
);

registerRuntimeCommand(
  "git.diff",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean().optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return getFileDiff(workspace.path, args.path, args.staged ?? false);
    },
  }
);

registerRuntimeCommand(
  "git.hunk",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean(),
    hunkId: z.string(),
    operation: z.enum(["stage", "unstage", "discard"]),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await applyGitHunkOperation(workspace.path, args);
      emitGitStateChanged(ctx as never, args.workspaceId, {
        worktreeChanged: true,
      });
      return {};
    },
  }
);

registerRuntimeCommand(
  "git.log",
  z.object({
    workspaceId: z.string(),
    limit: z.number().int().min(1).max(50).optional(),
    afterSha: gitCommitRevisionSchema.optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);

      debugGitHistoryCommand("command git.log request", {
        workspaceId: args.workspaceId,
        workspacePath: workspace.path,
        limit: args.limit ?? 5,
        afterSha: args.afterSha,
      });

      const history = await getGitHistory(workspace.path, {
        limit: args.limit ?? 5,
        afterSha: args.afterSha,
      });

      debugGitHistoryCommand("command git.log response", {
        workspaceId: args.workspaceId,
        entryCount: history.entries.length,
        hasMore: history.hasMore,
        firstSha: history.entries[0]?.sha,
        lastSha: history.entries.at(-1)?.sha,
      });

      return history;
    },
  }
);

registerRuntimeCommand(
  "git.show",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return {
        diff: await getGitCommitDiff(workspace.path, args.sha),
      };
    },
  }
);

registerRuntimeCommand(
  "git.commitDetail",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return getGitCommitDetail(workspace.path, args.sha);
    },
  }
);

registerRuntimeCommand(
  "git.commitFileDiff",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
    path: z.string(),
    oldPath: z.string().optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return getGitCommitFileDiff(workspace.path, args);
    },
  }
);

registerRuntimeCommand(
  "git.unstage",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await unstageFiles(workspace.path, args.paths);
      emitGitStateChanged(ctx as never, args.workspaceId);
      return {};
    },
  }
);

registerRuntimeCommand(
  "git.discard",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await discardChanges(workspace.path, args.paths);
      emitGitStateChanged(ctx as never, args.workspaceId, {
        treeChanged: true,
      });
      return {};
    },
  }
);

registerRuntimeCommand(
  "git.commit",
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await commitChanges(workspace.path, args.message);
      emitGitStateChanged(ctx as never, args.workspaceId, {
        branchChanged: true,
        worktreeChanged: true,
      });
      return result;
    },
  }
);

registerRuntimeCommand(
  "git.push",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    force: z.boolean().optional(),
    auth: gitHttpAuthSchema.optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await runGitNetworkOperation(ctx, args.workspaceId, () =>
        runGitPush(workspace.path, {
          remote: args.remote,
          branch: args.branch,
          force: args.force,
          auth: args.auth,
        })
      );
      emitGitStateChanged(ctx as never, args.workspaceId, {
        branchChanged: true,
        worktreeChanged: true,
      });
      return result;
    },
  }
);

registerRuntimeCommand(
  "git.pull",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    auth: gitHttpAuthSchema.optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await runGitNetworkOperation(ctx, args.workspaceId, () =>
        runGitPull(workspace.path, {
          remote: args.remote,
          branch: args.branch,
          auth: args.auth,
        })
      );
      ctx.hostBridge.recordWorkspaceFetch?.(args.workspaceId);
      emitGitStateChanged(ctx as never, args.workspaceId, {
        treeChanged: true,
        branchChanged: true,
        worktreeChanged: true,
      });
      return result;
    },
  }
);

registerRuntimeCommand(
  "git.fetch",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    prune: z.boolean().optional(),
    auth: gitHttpAuthSchema.optional(),
    background: z.boolean().optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx, meta) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);

      try {
        const isInternalBackgroundFetch = args.background === true && !meta?.clientId;
        const runFetch = () =>
          runGitFetch(workspace.path, {
            remote: args.remote,
            prune: args.prune,
            auth: args.auth,
            timeoutMs: args.background ? GIT_BACKGROUND_FETCH_TIMEOUT_MS : undefined,
          });
        const result = isInternalBackgroundFetch
          ? await runFetch()
          : await runGitNetworkOperation(ctx, args.workspaceId, runFetch);
        ctx.hostBridge.recordWorkspaceFetch?.(args.workspaceId);
        emitGitStateChanged(ctx as never, args.workspaceId, { branchChanged: true });
        return result;
      } catch (err) {
        if (args.background && err instanceof GitAuthError) {
          return { success: false, message: err.message, updatedRefs: [] };
        }
        throw err;
      }
    },
  }
);

registerRuntimeCommand(
  "git.checkout",
  z.object({
    workspaceId: z.string(),
    ref: z.string(),
    createBranch: z.boolean().optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await runGitCheckout(workspace.path, args.ref, {
        createBranch: args.createBranch,
      });
      if (result.success) {
        emitGitStateChanged(ctx as never, args.workspaceId, {
          treeChanged: true,
          branchChanged: true,
          worktreeChanged: true,
        });
      }
      return result;
    },
  }
);

registerRuntimeCommand(
  "git.branch",
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    startPoint: z.string().optional(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await runGitCreateBranch(workspace.path, args.name, {
        startPoint: args.startPoint,
      });
      emitGitStateChanged(ctx as never, args.workspaceId, {
        branchChanged: true,
        worktreeChanged: true,
      });
      return result;
    },
  }
);

registerRuntimeCommand(
  "git.branches",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => workspaceTarget(args.workspaceId),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return runGitListBranches(workspace.path);
    },
  }
);
