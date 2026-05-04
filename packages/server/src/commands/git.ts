/**
 * Git Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import {
  getGitStatus,
  stageFiles,
  unstageFiles,
  discardChanges,
  commitChanges,
  runGitPush,
  runGitPull,
  runGitCheckout,
  runGitCreateBranch,
  runGitListBranches,
} from '../git/cli.js';
import { getFileDiff } from '../git/diff.js';

function emitGitStateChanged(
  ctx: CommandContext,
  workspaceId: string,
  options?: {
    treeChanged?: boolean;
    branchChanged?: boolean;
    worktreeChanged?: boolean;
  }
) {
  ctx.eventBus.emit({
    type: 'git.state.changed',
    workspaceId,
    treeChanged: options?.treeChanged,
    branchChanged: options?.branchChanged,
    worktreeChanged: options?.worktreeChanged,
  });
}

const gitHttpAuthSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// git.status
registerCommand(
  'git.status',
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return getGitStatus(workspace.path);
  }
);

// git.stage
registerCommand(
  'git.stage',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    await stageFiles(workspace.path, args.paths);
    emitGitStateChanged(ctx, args.workspaceId);
    return {};
  }
);

// git.diff
registerCommand(
  'git.diff',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return {
      diff: await getFileDiff(workspace.path, args.path, args.staged ?? false),
    };
  }
);

// git.unstage
registerCommand(
  'git.unstage',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    await unstageFiles(workspace.path, args.paths);
    emitGitStateChanged(ctx, args.workspaceId);
    return {};
  }
);

// git.discard
registerCommand(
  'git.discard',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
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
  'git.commit',
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
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
  'git.push',
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
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitPush(workspace.path, {
      remote: args.remote,
      branch: args.branch,
      force: args.force,
      auth: args.auth,
    });
    emitGitStateChanged(ctx, args.workspaceId, {
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.pull
registerCommand(
  'git.pull',
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
    auth: gitHttpAuthSchema.optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await runGitPull(workspace.path, {
      remote: args.remote,
      branch: args.branch,
      auth: args.auth,
    });
    emitGitStateChanged(ctx, args.workspaceId, {
      treeChanged: true,
      branchChanged: true,
      worktreeChanged: true,
    });
    return result;
  }
);

// git.checkout
registerCommand(
  'git.checkout',
  z.object({
    workspaceId: z.string(),
    ref: z.string(),
    createBranch: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
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
  'git.branch',
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    startPoint: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
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
  'git.branches',
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return runGitListBranches(workspace.path);
  }
);
