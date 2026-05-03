/**
 * Tests for session.remove command
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dispatch, registerCommand } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { z } from 'zod';
import type { EventBus, DomainEvent } from '../bus/event-bus.js';

// Import command handlers to register them
import '../commands/session.js';

describe('session.remove command', () => {
  let ctx: CommandContext;
  let mockSessionMgr: {
    get: vi.Mock;
    delete: vi.Mock;
  };
  let mockEventBus: {
    emit: vi.Mock;
    on: vi.Mock;
    clear: vi.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionMgr = {
      get: vi.fn(),
      delete: vi.fn(),
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
      clear: vi.fn(),
    };

    ctx = {
      workspaceMgr: {} as any,
      sessionMgr: mockSessionMgr as any,
      terminalMgr: {} as any,
      eventBus: mockEventBus as any,
      broadcaster: {} as any,
      db: {} as any,
      providerRegistry: [] as any,
    };
  });

  it('should remove ended session', async () => {
    mockSessionMgr.get.mockReturnValue({
      id: 'session-1',
      state: 'ended',
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-1',
        op: 'session.remove',
        args: { sessionId: 'session-1' },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mockSessionMgr.delete).toHaveBeenCalledWith('session-1');
  });

  it('should error if session not found', async () => {
    mockSessionMgr.get.mockReturnValue(undefined);

    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-3',
        op: 'session.remove',
        args: { sessionId: 'non-existent' },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('session_not_found');
    expect(mockSessionMgr.delete).not.toHaveBeenCalled();
  });

  it('should error if session is running', async () => {
    mockSessionMgr.get.mockReturnValue({
      id: 'session-3',
      state: 'running',
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-4',
        op: 'session.remove',
        args: { sessionId: 'session-3' },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_state');
    expect(result.error?.message).toContain('running');
    expect(mockSessionMgr.delete).not.toHaveBeenCalled();
  });

  it('should error if session is starting', async () => {
    mockSessionMgr.get.mockReturnValue({
      id: 'session-4',
      state: 'starting',
    });

    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-5',
        op: 'session.remove',
        args: { sessionId: 'session-4' },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_state');
    expect(mockSessionMgr.delete).not.toHaveBeenCalled();
  });

  it('should validate sessionId is required', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'cmd-6',
        op: 'session.remove',
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('validation_error');
  });
});
