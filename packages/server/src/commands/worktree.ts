/**
 * Worktree Commands (Phase 3)
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import {
  listWorktrees,
  resolveWorktreePath,
  getWorktreeStatus,
  getWorktreeDiff,
  getWorktreeTree,
  createWorktree,
  removeWorktree,
} from '../git/worktree.js';

// worktree.list
registerCommand(
  'worktree.list',
  z.object({ workspaceId: z.string() }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }
    return { worktrees: await listWorktrees(workspace.path) };
  }
);

// worktree.status
registerCommand(
  'worktree.status',
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { status: await getWorktreeStatus(worktreePath) };
  }
);

// worktree.diff
registerCommand(
  'worktree.diff',
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    staged: z.boolean().optional().default(false),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { diff: await getWorktreeDiff(worktreePath, args.staged) };
  }
);

// worktree.tree
registerCommand(
  'worktree.tree',
  z.object({ workspaceId: z.string(), worktreePath: z.string() }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    return { tree: await getWorktreeTree(worktreePath) };
  }
);

// worktree.create
registerCommand(
  'worktree.create',
  z.object({
    workspaceId: z.string(),
    branch: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }
    return { worktree: await createWorktree(workspace.path, args.branch, args.path) };
  }
);

// worktree.remove
registerCommand(
  'worktree.remove',
  z.object({
    workspaceId: z.string(),
    worktreePath: z.string(),
    force: z.boolean().optional().default(false),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const worktreePath = await resolveWorktreePath(workspace.path, args.worktreePath);
    await removeWorktree(workspace.path, worktreePath, args.force);
    return {};
  }
);
