/**
 * Worktree Commands (Phase 3)
 */

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
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";
import { emitGitStateChanged } from "./git-events.js";

async function findRelatedWorkspaceIds(
  ctx: CommandContext,
  workspacePath: string
): Promise<string[]> {
  const targetCommonDir = await getGitCommonDirPath(workspacePath);
  const relatedWorkspaceIds = await Promise.all(
    ctx.workspaceMgr.list().map(async (workspace) => {
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

function emitWorktreeChangedForWorkspaceIds(ctx: CommandContext, workspaceIds: string[]) {
  for (const workspaceId of workspaceIds) {
    emitGitStateChanged(ctx, workspaceId, { worktreeChanged: true });
  }
}

// worktree.list
registerCommand("worktree.list", z.object({ workspaceId: z.string() }), async (args, ctx) => {
  const workspace = ctx.workspaceMgr.get(args.workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
  }
  return { worktrees: await listWorktrees(workspace.path) };
});

// worktree.status
registerCommand(
  "worktree.status",
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { status: await getWorktreeStatus(worktreePath) };
  }
);

// worktree.diff
registerCommand(
  "worktree.diff",
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    staged: z.boolean().optional().default(false),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { diff: await getWorktreeDiff(worktreePath, args.staged) };
  }
);

// worktree.tree
registerCommand(
  "worktree.tree",
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { tree: await getWorktreeTree(worktreePath) };
  }
);

// worktree.create
registerCommand(
  "worktree.create",
  z.object({
    workspaceId: z.string(),
    branch: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const relatedWorkspaceIds = await findRelatedWorkspaceIds(ctx, workspace.path);
    const worktree = await createWorktree(workspace.path, args.branch, args.path);
    emitWorktreeChangedForWorkspaceIds(ctx, relatedWorkspaceIds);
    return { worktree };
  }
);

// worktree.remove
registerCommand(
  "worktree.remove",
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    force: z.boolean().optional().default(false),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const relatedWorkspaceIds = await findRelatedWorkspaceIds(ctx, workspace.path);
    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    await removeWorktree(workspace.path, worktreePath, args.force);
    emitWorktreeChangedForWorkspaceIds(ctx, relatedWorkspaceIds);
    return {};
  }
);
