/**
 * Worktree Commands (Phase 3)
 */

import path from "node:path";
import { z } from "zod";
import {
  createWorktree,
  getGitCommonDirPath,
  getWorktreeDiff,
  getWorktreeStatus,
  getWorktreeTree,
  listWorktrees,
  removeWorktree,
  resolveWorktreePath,
} from "../git/worktree.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import { emitGitStateChanged } from "./git-events.js";

async function findRelatedWorkspaceIds(
  ctx: RuntimeCommandContext,
  workspacePath: string
): Promise<string[]> {
  const targetCommonDir = await getGitCommonDirPath(workspacePath);
  const relatedWorkspaceIds = await Promise.all(
    ctx.workspaceLookup.list().map(async (workspace) => {
      try {
        const commonDir = await getGitCommonDirPath(workspace.path);
        return commonDir === targetCommonDir ? workspace.id : null;
      } catch {
        return null;
      }
    })
  );

  return relatedWorkspaceIds.filter((workspaceId): workspaceId is string => Boolean(workspaceId));
}

function emitWorktreeChangedForWorkspaceIds(ctx: RuntimeCommandContext, workspaceIds: string[]) {
  for (const workspaceId of workspaceIds) {
    if (!ctx.workspaceLookup.get(workspaceId)) {
      continue;
    }
    emitGitStateChanged(ctx as never, workspaceId, { worktreeChanged: true });
  }
}

function isWorkspaceOpenForPath(ctx: RuntimeCommandContext, workspacePath: string): boolean {
  const targetPath = path.resolve(workspacePath);
  return ctx.workspaceLookup
    .list()
    .some((openWorkspace) => path.resolve(openWorkspace.path) === targetPath);
}

// worktree.list
registerRuntimeCommand("worktree.list", z.object({ workspaceId: z.string() }), {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    const workspace = ctx.workspaceLookup.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }
    return { worktrees: await listWorktrees(workspace.path) };
  },
});

// worktree.status
registerRuntimeCommand(
  "worktree.status",
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
      return { status: await getWorktreeStatus(worktreePath) };
    },
  }
);

// worktree.diff
registerRuntimeCommand(
  "worktree.diff",
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    staged: z.boolean().optional().default(false),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
      return { diff: await getWorktreeDiff(worktreePath, args.staged) };
    },
  }
);

// worktree.tree
registerRuntimeCommand(
  "worktree.tree",
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
      return { tree: await getWorktreeTree(worktreePath) };
    },
  }
);

// worktree.create
registerRuntimeCommand(
  "worktree.create",
  z.object({
    workspaceId: z.string(),
    branch: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const relatedWorkspaceIds = await findRelatedWorkspaceIds(ctx, workspace.path);
      const worktree = await createWorktree(workspace.path, args.branch, args.path);
      emitWorktreeChangedForWorkspaceIds(ctx, relatedWorkspaceIds);
      return { worktree };
    },
  }
);

// worktree.remove
registerRuntimeCommand(
  "worktree.remove",
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    force: z.boolean().optional().default(false),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const relatedWorkspaceIds = await findRelatedWorkspaceIds(ctx, workspace.path);
      const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
      if (isWorkspaceOpenForPath(ctx, worktreePath)) {
        throw {
          code: "worktree_in_use",
          message: `Cannot remove an open worktree workspace: ${worktreePath}`,
        };
      }

      await removeWorktree(workspace.path, worktreePath, args.force);
      emitWorktreeChangedForWorkspaceIds(ctx, relatedWorkspaceIds);
      return {};
    },
  }
);
