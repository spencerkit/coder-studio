/**
 * Terminal Commands
 */

import { basename } from 'node:path';
import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

function resolveShellCommand(): { argv: string[]; title: string } {
  const shellPath =
    process.platform === 'win32'
      ? process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || '/bin/bash';

  return {
    argv: [shellPath],
    title: basename(shellPath) || shellPath,
  };
}

// terminal.list
registerCommand(
  'terminal.list',
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    return ctx.terminalMgr
      .getAll()
      .map((terminal) => terminal.toDTO())
      .filter((terminal) => terminal.workspaceId === args.workspaceId);
  }
);

// terminal.create
registerCommand(
  'terminal.create',
  z.object({
    workspaceId: z.string(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    const shell = resolveShellCommand();

    // Create shell terminal
    const terminal = ctx.terminalMgr.create({
      workspaceId: args.workspaceId,
      kind: 'shell',
      argv: shell.argv,
      title: shell.title,
      cwd: workspace.path,
      cols: args.cols ?? 120,
      rows: args.rows ?? 30,
    });

    return terminal;
  }
);

// terminal.replay
registerCommand(
  'terminal.replay',
  z.object({
    terminalId: z.string(),
    lastSeq: z.number().int().nonnegative().optional(),
  }),
  async (args, ctx) => {
    const replay = ctx.terminalMgr.replay(args.terminalId, args.lastSeq ?? 0);

    if (replay.status !== 'ok') {
      return replay;
    }

    return {
      status: 'ok' as const,
      chunk: replay.data.toString('base64'),
      seq: replay.seq,
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
    ctx.terminalMgr.kill(args.terminalId);
  }
);

// terminal.input
registerCommand(
  'terminal.input',
  z.object({
    terminalId: z.string(),
    bytes: z.string(), // Base64 encoded
    activity: z.enum(['typing', 'submit', 'system']).optional(),
  }),
  async (args, ctx) => {
    const buffer = Buffer.from(args.bytes, 'base64');
    ctx.terminalMgr.write(args.terminalId, buffer);
    ctx.sessionMgr.onTerminalInput(args.terminalId, args.activity);
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
    ctx.terminalMgr.resize(args.terminalId, args.cols, args.rows);
  }
);
