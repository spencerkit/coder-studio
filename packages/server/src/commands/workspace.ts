/**
 * Workspace Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// workspace.list
registerCommand(
  'workspace.list',
  z.object({}),
  async (_args, ctx) => {
    return ctx.workspaceMgr.list();
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
    return ctx.workspaceMgr.open({
      path: args.path,
      targetRuntime: (args.targetRuntime as 'node' | 'bun' | 'deno') || 'node',
    });
  }
);

// workspace.close
registerCommand(
  'workspace.close',
  z.object({
    id: z.string(),
  }),
  async (args, ctx) => {
    await ctx.workspaceMgr.close(args.id);
  }
);
