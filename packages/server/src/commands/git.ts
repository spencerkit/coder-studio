/**
 * Git Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
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

    return stageFiles(workspace.path, args.paths);
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

    return unstageFiles(workspace.path, args.paths);
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

    return discardChanges(workspace.path, args.paths);
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

    return commitChanges(workspace.path, args.message);
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
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return runGitPush(workspace.path, {
      remote: args.remote,
      branch: args.branch,
      force: args.force,
    });
  }
);

// git.pull
registerCommand(
  'git.pull',
  z.object({
    workspaceId: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return runGitPull(workspace.path, {
      remote: args.remote,
      branch: args.branch,
    });
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

    return runGitCheckout(workspace.path, args.ref, {
      createBranch: args.createBranch,
    });
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

    return runGitCreateBranch(workspace.path, args.name, {
      startPoint: args.startPoint,
    });
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
