import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeTerminalBinaryFrame,
  TerminalBinaryFrameType,
  type Terminal,
} from '@coder-studio/core';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';

import '../commands/terminal.js';
import { registerPendingTerminalInput } from '../commands/terminal.js';

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {} as never,
    workspaceMgr: {
      get: vi.fn().mockReturnValue({
        id: 'ws-1',
        path: '/tmp/workspace',
      }),
    } as never,
    sessionMgr: {
      findSessionIdByTerminal: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
    } as never,
    terminalMgr: {
      create: vi.fn().mockImplementation((spec) => ({
        id: 'term-1',
        workspaceId: spec.workspaceId,
        kind: spec.kind,
        title: spec.title ?? spec.argv[0],
        cwd: spec.cwd,
        argv: spec.argv,
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 30,
        alive: true,
        createdAt: Date.now(),
      } satisfies Terminal)),
      getAll: vi.fn().mockReturnValue([]),
      replay: vi.fn(),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    } as never,
    hooksMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {
      broadcast: vi.fn(),
      sendToClient: vi.fn(),
      sendBinaryToClient: vi.fn(),
    } as never,
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    providerRegistry: [],
    ...overrides,
  };
}

describe('terminal commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns binary metadata and sends replay payload to requesting client', async () => {
    const replayData = Buffer.from('replay payload');
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: 'ok', data: replayData, seq: 9 }),
        kill: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-replay-1',
        op: 'terminal.replay',
        args: {
          terminalId: 'term-1',
        },
      },
      ctx,
      'client-1'
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: 'ok',
      transport: 'binary',
      streamId: expect.any(Number),
      size: replayData.length,
      seq: 9,
    });
    expect(ctx.broadcaster.sendBinaryToClient).toHaveBeenCalledWith('client-1', expect.any(Buffer));
  });

  it('keeps replay streamId consistent between metadata and binary frame', async () => {
    const replayData = Buffer.from('replay payload');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_777_177_555_456);
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: 'ok', data: replayData, seq: 9 }),
        kill: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'terminal-replay-stream-id-1',
          op: 'terminal.replay',
          args: {
            terminalId: 'term-1',
          },
        },
        ctx,
        'client-1'
      );

      expect(result.ok).toBe(true);
      expect(ctx.broadcaster.sendBinaryToClient).toHaveBeenCalledWith('client-1', expect.any(Buffer));

      const replayFrame = vi.mocked(ctx.broadcaster.sendBinaryToClient).mock.calls[0]?.[1] as Buffer;
      const { header, payload } = decodeTerminalBinaryFrame(replayFrame);

      expect(header.type).toBe(TerminalBinaryFrameType.Replay);
      expect(result.data).toMatchObject({
        status: 'ok',
        transport: 'binary',
        streamId: header.streamId,
        size: replayData.length,
        seq: 9,
      });
      expect(Buffer.from(payload)).toEqual(replayData);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses the current user shell when creating shell terminals', async () => {
    vi.stubEnv('SHELL', '/bin/zsh');
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-create-1',
        op: 'terminal.create',
        args: {
          workspaceId: 'ws-1',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ['/bin/zsh', '-i'],
        title: 'zsh',
      })
    );
  });

  it('delegates terminal.input binary payload to sessionMgr.sendInput when a session owns the terminal', async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue('sess-1'),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from('二进制输入');
    const streamId = 42;

    registerPendingTerminalInput(
      {
        terminalId: 'term-1',
        transport: 'binary',
        streamId,
        size: bytes.length,
        activity: 'submit',
      },
      bytes
    );

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-input-binary-1',
        op: 'terminal.input',
        args: {
          terminalId: 'term-1',
          transport: 'binary',
          streamId,
          size: bytes.length,
          activity: 'submit',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith('sess-1', bytes, 'submit');
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it('delegates terminal.input to sessionMgr.sendInput when a session owns the terminal', async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue('sess-1'),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from('hi').toString('base64');

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-input-1',
        op: 'terminal.input',
        args: {
          terminalId: 'term-1',
          bytes,
          activity: 'submit',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.findSessionIdByTerminal).toHaveBeenCalledWith('term-1');
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith('sess-1', Buffer.from('hi'), 'submit');
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it('falls back to terminalMgr.write for terminal.input when no session owns the terminal', async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue(undefined),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from('ls\n').toString('base64');

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-input-2',
        op: 'terminal.input',
        args: {
          terminalId: 'term-shell',
          bytes,
          activity: 'submit',
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.write).toHaveBeenCalledWith('term-shell', Buffer.from('ls\n'));
    expect(ctx.sessionMgr.sendInput).not.toHaveBeenCalled();
  });

  it('delegates terminal.resize to sessionMgr.resize when a session owns the terminal', async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue('sess-1'),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-resize-1',
        op: 'terminal.resize',
        args: {
          terminalId: 'term-1',
          cols: 120,
          rows: 40,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.findSessionIdByTerminal).toHaveBeenCalledWith('term-1');
    expect(ctx.sessionMgr.resize).toHaveBeenCalledWith('sess-1', 120, 40);
    expect(ctx.terminalMgr.resize).not.toHaveBeenCalled();
  });

  it('falls back to terminalMgr.resize when no session owns the terminal', async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue(undefined),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'terminal-resize-2',
        op: 'terminal.resize',
        args: {
          terminalId: 'term-shell',
          cols: 80,
          rows: 24,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.resize).toHaveBeenCalledWith('term-shell', 80, 24);
    expect(ctx.sessionMgr.resize).not.toHaveBeenCalled();
  });
});
