import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../bus/event-bus.js';
import { SessionManager } from '../session/manager.js';
import { TerminalManager } from '../terminal/manager.js';
import type { SessionDatabase } from '../session/types.js';
import type { Broadcaster } from '../ws/hub.js';
import type { PtyHost, PtyProcess, TerminalDatabase } from '../terminal/types.js';
import type { ProviderDefinition } from '@coder-studio/core';

describe('SessionManager session-level API', () => {
  let eventBus: EventBus;
  let terminalMgr: TerminalManager;
  let sessionMgr: SessionManager;
  let ptyWrites: Buffer[];
  let ptyResizes: Array<[number, number]>;
  let mockPty: PtyProcess;
  let provider: ProviderDefinition;

  beforeEach(() => {
    ptyWrites = [];
    ptyResizes = [];

    mockPty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn((bytes: Buffer | string) => {
        ptyWrites.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      }),
      resize: vi.fn((cols: number, rows: number) => {
        ptyResizes.push([cols, rows]);
      }),
      kill: vi.fn(),
    };

    const ptyHost: PtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    const terminalDb: TerminalDatabase = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };

    const sessionDb: SessionDatabase = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn().mockReturnValue([]),
      listHydratable: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    provider = {
      id: 'stub',
      displayName: 'Stub',
      capability: 'full',
      defaultConfig: {},
      buildCommand: () => ({ argv: ['stub'], cwd: '/tmp', env: {} }),
      hooks: {
        events: {
          sessionStart: false,
          turnCompleted: true,
          stop: true,
          progress: false,
        },
      },
    } as ProviderDefinition;

    eventBus = new EventBus();
    terminalMgr = new TerminalManager({ ptyHost, eventBus, db: terminalDb });
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: { get: vi.fn(() => undefined) } as any,
    });
  });

  const createSession = async () => {
    const session = await sessionMgr.create({
      workspaceId: 'ws-1',
      workspacePath: '/tmp',
      providerId: provider.id,
      provider,
    });

    return session;
  };

  it('sendInput writes to PTY and updates session activity for submit', async () => {
    const session = await createSession();

    sessionMgr.sendInput(session.id, Buffer.from('hello\r'), 'submit');

    expect(ptyWrites[0]?.toString()).toBe('hello\r');
    expect(sessionMgr.get(session.id)?.state).toBe('running');
  });

  it('resize forwards to the underlying PTY', async () => {
    const session = await createSession();

    sessionMgr.resize(session.id, 100, 40);

    expect(ptyResizes[0]).toEqual([100, 40]);
  });

  it('getOutputTail returns the last N bytes from the session terminal buffer', async () => {
    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls[0]?.[0];
    expect(onData).toBeTypeOf('function');

    onData?.('abcdefghij');

    expect(sessionMgr.getOutputTail(session.id, 4).toString()).toBe('ghij');
  });

  it('throws on unknown session id for sendInput', () => {
    expect(() => sessionMgr.sendInput('sess-missing', Buffer.from('x'))).toThrow(/Session not found/);
  });
});
