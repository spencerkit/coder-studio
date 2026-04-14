/**
 * Git Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { getGitStatus, stageFiles, unstageFiles, discardChanges, commitChanges } from '../git/cli.js';

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
