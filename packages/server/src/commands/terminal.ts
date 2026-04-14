/**
 * Terminal Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// terminal.create
registerCommand(
  'terminal.create',
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    // TODO: Create terminal via TerminalManager
    // const terminal = await ctx.terminalMgr.create({
    //   workspaceId: args.workspaceId,
    //   cwd: workspace.path,
    // });

    // return terminal;

    // Placeholder
    return {
      id: 'placeholder-terminal-id',
      workspaceId: args.workspaceId,
      pid: null,
      cols: 120,
      rows: 30,
      createdAt: Date.now(),
    };
  }
);

// terminal.close
registerCommand(
  'terminal.close',
  z.object({
    terminalId: z.string(),
  }),
  async (args, ctx) => {
    // TODO: Close terminal via TerminalManager
    // await ctx.terminalMgr.close(args.terminalId);
  }
);

// terminal.input
registerCommand(
  'terminal.input',
  z.object({
    terminalId: z.string(),
    bytes: z.string(), // Base64 encoded
  }),
  async (args, ctx) => {
    // TODO: Send input to terminal via TerminalManager
    // await ctx.terminalMgr.write(args.terminalId, args.bytes);
  }
);

// terminal.resize
registerCommand(
  'terminal.resize',
  z.object({
    terminalId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  async (args, ctx) => {
    // TODO: Resize terminal via TerminalManager
    // await ctx.terminalMgr.resize(args.terminalId, args.cols, args.rows);
  }
);
