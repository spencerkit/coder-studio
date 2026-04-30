/**
 * Terminal Commands
 */

import {
  TerminalInputBase64Args,
  TerminalInputBinaryArgs,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TerminalBinaryFrameType,
  encodeTerminalBinaryFrame,
} from '@coder-studio/core';
import { basename } from 'node:path';
import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

const TerminalInputSchema = z.union([
  z.object({
    terminalId: z.string(),
    bytes: z.string(),
    activity: z.enum(['typing', 'submit', 'system']).optional(),
    submittedText: z.string().optional(),
  }),
  z.object({
    terminalId: z.string(),
    transport: z.literal('binary'),
    streamId: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    activity: z.enum(['typing', 'submit', 'system']).optional(),
    submittedText: z.string().optional(),
  }),
]);

const pendingTerminalInput = new Map<number, { args: TerminalInputBinaryArgs; payload: Buffer }>();

function decodeTerminalInput(args: TerminalInputBase64Args | TerminalInputBinaryArgs): Buffer {
  if ('bytes' in args) {
    return Buffer.from(args.bytes, 'base64');
  }

  const pending = pendingTerminalInput.get(args.streamId);
  if (!pending) {
    throw { code: 'terminal_input_binary_missing', message: 'Missing binary terminal input payload' };
  }
  pendingTerminalInput.delete(args.streamId);
  return pending.payload;
}

export function registerPendingTerminalInput(args: TerminalInputBinaryArgs, payload: Buffer): void {
  pendingTerminalInput.set(args.streamId, { args, payload });
}

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
  async (args, ctx, clientId) => {
    const replay = ctx.terminalMgr.replay(args.terminalId, args.lastSeq ?? 0);

    if (replay.status !== 'ok') {
      return replay;
    }

    const streamId = Date.now() >>> 0;
    if (clientId) {
      ctx.broadcaster.sendBinaryToClient(
        clientId,
        Buffer.from(
          encodeTerminalBinaryFrame(
            {
              version: TERMINAL_BINARY_PROTOCOL_VERSION,
              type: TerminalBinaryFrameType.Replay,
              flags: 0,
              meta: replay.seq,
              streamId,
              payloadSize: replay.data.length,
            },
            replay.data,
          ),
        ),
      );
    }

    return {
      status: 'ok' as const,
      transport: 'binary' as const,
      streamId,
      size: replay.data.length,
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
  TerminalInputSchema,
  async (args, ctx) => {
    const buffer = decodeTerminalInput(args);
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    console.log('[DEBUG] terminal.input command:', {
      terminalId: args.terminalId,
      sessionId,
      activity: args.activity,
      bufferSize: buffer.length,
      bufferPreview: buffer.toString('utf-8').substring(0, 50),
    });
    if (sessionId) {
      ctx.sessionMgr.sendInput(sessionId, buffer, args.activity, args.submittedText);
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
