/**
 * Terminal Commands
 */

import { basename } from 'node:path';
import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

function resolveShellCommand(): { argv: string[]; title: string } {
  if (process.platform === 'win32') {
    const shellPath = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return {
      argv: [shellPath],
      title: basename(shellPath) || shellPath,
    };
  }

  const shellPath = process.env.SHELL || '/bin/bash';
  const shellName = basename(shellPath);
  // Launch as interactive (non-login) shell so the user's rc files load for
  // PS1 colors and `ls --color=auto` aliases. Login (-l) is intentionally
  // omitted: it sources profile scripts whose welcome banners / motd output
  // produce spurious blank lines in the pane for most users.
  const argv = shellName === 'cmd.exe' ? [shellPath] : [shellPath, '-i'];

  return {
    argv,
    title: shellName || shellPath,
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
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    if (sessionId) {
      ctx.sessionMgr.sendInput(sessionId, buffer, args.activity);
      return;
    }

    ctx.terminalMgr.write(args.terminalId, buffer);
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
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    if (sessionId) {
      ctx.sessionMgr.resize(sessionId, args.cols, args.rows);
      return;
    }

    ctx.terminalMgr.resize(args.terminalId, args.cols, args.rows);
  }
);
