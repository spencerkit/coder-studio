/**
 * Tests for SessionManager title derivation.
 *
 * The title comes from the *first* user-submitted instruction (the UTF-8
 * decoded bytes of a terminal.input call with activity='submit'), is trimmed
 * and truncated to SESSION_TITLE_MAX_LENGTH (10), and is assigned at most
 * once per session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager, type SessionManagerDeps } from '../session/manager.js';
import type { Broadcaster } from '../ws/hub.js';

describe('SessionManager title derivation', () => {
  let sessionMgr: SessionManager;
  let mockDb: {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByWorkspaceId: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let mockEventBus: {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockTerminalMgr: {
    create: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn(),
      delete: vi.fn(),
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
    };

    mockTerminalMgr = {
      create: vi.fn().mockReturnValue({
        id: 'terminal-1',
        workspaceId: 'ws-1',
        kind: 'agent',
      }),
      kill: vi.fn(),
    };

    const deps: SessionManagerDeps = {
      terminalMgr: mockTerminalMgr as any,
      eventBus: mockEventBus as any,
      db: mockDb as any,
      broadcaster: {} as Broadcaster,
      providerRegistry: [],
      providerConfigRepo: { get: vi.fn(() => undefined) } as any,
    };

    sessionMgr = new SessionManager(deps);
  });

  async function createSession() {
    const session = await sessionMgr.create({
      workspaceId: 'ws-1',
      workspacePath: '/test/path',
      providerId: 'test-provider',
      provider: {
        id: 'test-provider',
        displayName: 'Test Provider',
        capability: 'full',
        buildCommand: () => ({ argv: ['test'], cwd: '/test' }),
      } as any,
    });
    // Reset mocks so assertions only see post-create calls.
    mockDb.update.mockClear();
    mockEventBus.emit.mockClear();
    return session;
  }

  it('captures the first submitted instruction as the session title', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'fix the build\n');

    expect(mockDb.update).toHaveBeenCalledWith(session.id, { title: 'fix the b…' });
    expect(sessionMgr.get(session.id)?.title).toBe('fix the b…');
  });

  it('uses the raw text when it already fits in 10 chars', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'hi there\n');

    expect(sessionMgr.get(session.id)?.title).toBe('hi there');
  });

  it('collapses whitespace and trims before truncating', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', '   hello   world  \n');

    // "hello world" is 11 chars, so it truncates to 9 chars + ellipsis.
    expect(sessionMgr.get(session.id)?.title).toBe('hello wor…');
  });

  it('does not overwrite an already-assigned title on later submits', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'first message\n');
    const firstTitle = sessionMgr.get(session.id)?.title;
    expect(firstTitle).toBeDefined();

    mockDb.update.mockClear();
    sessionMgr.onTerminalInput('terminal-1', 'submit', 'second message\n');

    // Nothing about the title should have been written to the DB.
    const updateCalls = mockDb.update.mock.calls;
    for (const [, patch] of updateCalls) {
      expect(patch).not.toHaveProperty('title');
    }
    expect(sessionMgr.get(session.id)?.title).toBe(firstTitle);
  });

  it('ignores non-submit activity for title derivation', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'typing', 'keypress');
    sessionMgr.onTerminalInput('terminal-1', 'control', 'ping');
    sessionMgr.onTerminalInput('terminal-1', 'internal_submit', 'ping');

    expect(sessionMgr.get(session.id)?.title).toBeUndefined();
    const updateCalls = mockDb.update.mock.calls;
    for (const [, patch] of updateCalls) {
      expect(patch).not.toHaveProperty('title');
    }
  });

  it('ignores empty/whitespace-only submits', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', '   \n\t  ');

    expect(sessionMgr.get(session.id)?.title).toBeUndefined();
    const updateCalls = mockDb.update.mock.calls;
    for (const [, patch] of updateCalls) {
      expect(patch).not.toHaveProperty('title');
    }
  });

  it('derives the title from submitted text instead of terminal buffer state', async () => {
    const session = await createSession();

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'new prompt\n');

    expect(sessionMgr.get(session.id)?.title).toBe('new prompt');
    expect(mockDb.update).toHaveBeenCalledWith(session.id, { title: 'new prompt' });
  });

  it('broadcasts state.changed so clients pick up the new title', async () => {
    const session = await createSession();

    // Put the session into 'running' so onTerminalInput won't also flip state.
    const internal = (sessionMgr as any).sessions.get(session.id);
    internal.state = 'running';

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'hello world hi\n');

    // Exactly one state.changed should have fired with the title attached.
    const stateEvents = mockEventBus.emit.mock.calls
      .map((args) => args[0])
      .filter((ev) => ev.type === 'session.state.changed');
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]).toMatchObject({
      sessionId: session.id,
      from: 'running',
      to: 'running',
      session: expect.objectContaining({ title: 'hello wor…' }),
    });
  });

  it('still flips idle -> running and records the title in one pass', async () => {
    const session = await createSession();
    const internal = (sessionMgr as any).sessions.get(session.id);
    internal.state = 'idle';

    sessionMgr.onTerminalInput('terminal-1', 'submit', 'run tests\n');

    const stateEvents = mockEventBus.emit.mock.calls
      .map((args) => args[0])
      .filter((ev) => ev.type === 'session.state.changed');
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]).toMatchObject({
      from: 'idle',
      to: 'running',
      session: expect.objectContaining({ title: 'run tests' }),
    });
  });
});
