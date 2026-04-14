/**
 * Workspace Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// workspace.list
registerCommand(
  'workspace.list',
  z.object({}), // No args
  async (_args, ctx) => {
    const workspaces = await ctx.db.workspace.findAll();
    return workspaces;
  }
);

// workspace.open
registerCommand(
  'workspace.open',
  z.object({
    path: z.string(),
    targetRuntime: z.enum(['node', 'bun', 'deno']).optional(),
  }),
  async (args, ctx) => {
    // Check if workspace already exists
    const existing = await ctx.db.workspace.findByPath(args.path);
    if (existing) {
      return existing;
    }

    // Create new workspace
    const workspace = await ctx.db.workspace.create({
      path: args.path,
      targetRuntime: args.targetRuntime || 'node',
    });

    return workspace;
  }
);

// workspace.close
registerCommand(
  'workspace.close',
  z.object({
    id: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.id}`);
    }

    // TODO: Terminate all sessions in workspace
    // await ctx.sessionMgr.terminateAllForWorkspace(args.id);

    await ctx.db.workspace.delete(args.id);
  }
);
