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
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";
import { emitGitStateChanged } from "./git-events.js";

const gitHttpAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});
const gitCommitRevisionSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{7,64}$/, "Invalid git commit revision");

const GIT_BACKGROUND_FETCH_TIMEOUT_MS = 30 * 1000;

async function runGitNetworkOperation<T>(
  ctx: CommandContext,
  workspaceId: string,
  op: () => Promise<T>
): Promise<T> {
  if (!ctx.autoFetch?.runExclusive) {
    return op();
  }

  return ctx.autoFetch.runExclusive(workspaceId, op);
}

// git.status
registerCommand(
  "git.status",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return getGitStatus(workspace.path);
  }
);

// git.stage
registerCommand(
  "git.stage",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await stageFiles(workspace.path, args.paths);
    emitGitStateChanged(ctx, args.workspaceId);
    return {};
  }
);

// git.diff
registerCommand(
  "git.diff",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return getFileDiff(workspace.path, args.path, args.staged ?? false);
  }
);

// git.hunk
registerCommand(
  "git.hunk",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean(),
    hunkId: z.string(),
    operation: z.enum(["stage", "unstage", "discard"]),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await applyGitHunkOperation(workspace.path, args);
    emitGitStateChanged(ctx, args.workspaceId, {
      worktreeChanged: true,
    });
    return {};
  }
);

// git.log
registerCommand(
  "git.log",
  z.object({
    workspaceId: z.string(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return {
      entries: await getGitHistory(workspace.path, args.limit ?? 5),
    };
  }
);

// git.show
registerCommand(
  "git.show",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return {
      diff: await getGitCommitDiff(workspace.path, args.sha),
    };
  }
);

// git.commitDetail
registerCommand(
  "git.commitDetail",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return getGitCommitDetail(workspace.path, args.sha);
  }
);

// git.commitFileDiff
registerCommand(
  "git.commitFileDiff",
  z.object({
    workspaceId: z.string(),
    sha: gitCommitRevisionSchema,
    path: z.string(),
    oldPath: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return getGitCommitFileDiff(workspace.path, args);
  }
);

// git.unstage
registerCommand(
  "git.unstage",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await unstageFiles(workspace.path, args.paths);
    emitGitStateChanged(ctx, args.workspaceId);
    return {};
  }
);

// git.discard
registerCommand(
  "git.discard",
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await discardChanges(workspace.path, args.paths);
    emitGitStateChanged(ctx, args.workspaceId, {
      treeChanged: true,
    });
    return {};
  }
);

// git.commit
registerCommand(
  "git.commit",
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await commitChanges(workspace.path, args.message);
    emitGitStateChanged(ctx, args.workspaceId, {
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.push
registerCommand(
  "git.push",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    force: z.boolean().optional(),
    auth: gitHttpAuthSchema.optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitNetworkOperation(ctx, args.workspaceId, () =>
      runGitPush(workspace.path, {
        remote: args.remote,
        branch: args.branch,
        force: args.force,
        auth: args.auth,
      })
    );
    emitGitStateChanged(ctx, args.workspaceId, {
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.pull
registerCommand(
  "git.pull",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    auth: gitHttpAuthSchema.optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitNetworkOperation(ctx, args.workspaceId, () =>
      runGitPull(workspace.path, {
        remote: args.remote,
        branch: args.branch,
        auth: args.auth,
      })
    );
    ctx.workspaceMgr.recordFetch(args.workspaceId);
    emitGitStateChanged(ctx, args.workspaceId, {
      treeChanged: true,
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.fetch
registerCommand(
  "git.fetch",
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    prune: z.boolean().optional(),
    auth: gitHttpAuthSchema.optional(),
    background: z.boolean().optional(),
  }),
  async (args, ctx, clientId) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    try {
      // AutoFetchScheduler already holds the per-workspace lock before it
      // dispatches an internal background fetch. Client-originated requests
      // must still serialize through the shared network-operation gate.
      const isInternalBackgroundFetch = args.background === true && !clientId;
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
      ctx.workspaceMgr.recordFetch(args.workspaceId);
      emitGitStateChanged(ctx, args.workspaceId, { branchChanged: true });
      return result;
    } catch (err) {
      if (args.background && err instanceof GitAuthError) {
        return { success: false, message: err.message, updatedRefs: [] };
      }
      throw err;
    }
  }
);

// git.checkout
registerCommand(
  "git.checkout",
  z.object({
    workspaceId: z.string(),
    ref: z.string(),
    createBranch: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitCheckout(workspace.path, args.ref, {
      createBranch: args.createBranch,
    });
    if (result.success) {
      emitGitStateChanged(ctx, args.workspaceId, {
        treeChanged: true,
        branchChanged: true,
        worktreeChanged: true,
      });
    }
    return result;
  }
);

// git.branch
registerCommand(
  "git.branch",
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    startPoint: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitCreateBranch(workspace.path, args.name, {
      startPoint: args.startPoint,
    });
    emitGitStateChanged(ctx, args.workspaceId, {
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.branches
registerCommand(
  "git.branches",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return runGitListBranches(workspace.path);
  }
);
