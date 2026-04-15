/**
 * Tests for SessionManager.delete method
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager, type SessionManagerDeps } from '../session/manager.js';
import type { EventBus, DomainEvent } from '../bus/event-bus.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { Broadcaster } from '../ws/hub.js';

describe('SessionManager.delete', () => {
  let sessionMgr: SessionManager;
  let mockDb: {
    insert: vi.Mock;
    update: vi.Mock;
    findById: vi.Mock;
    findByWorkspaceId: vi.Mock;
    delete: vi.Mock;
  };
  let mockEventBus: {
    emit: vi.Mock;
    on: vi.Mock;
  };
  let mockTerminalMgr: {
    create: vi.Mock;
    kill: vi.Mock;
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
    };

    sessionMgr = new SessionManager(deps);
  });

  it('should delete ended session from memory and database', async () => {
    // Create a session first
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

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

    // Manually set state to ended
    // First get the internal session
    const internalSession = (sessionMgr as any).sessions.get(session.id);
    internalSession.state = 'ended';

    // Now delete
    sessionMgr.delete(session.id);

    expect(mockDb.delete).toHaveBeenCalledWith(session.id);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.lifecycle',
        sessionId: session.id,
        event: 'removed',
      })
    );

    // Verify session is removed from memory
    expect(sessionMgr.get(session.id)).toBeUndefined();
  });

  it('should throw error when deleting non-existent session', () => {
    expect(() => sessionMgr.delete('non-existent')).toThrow(
      'Session not found: non-existent'
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should throw error when deleting running session', async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

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

    // Session is in 'starting' state after create
    expect(() => sessionMgr.delete(session.id)).toThrow(
      'Cannot delete session in state: starting'
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should allow deleting unavailable session', async () => {
    mockDb.insert.mockImplementation(() => {});
    mockDb.update.mockImplementation(() => {});

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

    // Set state to unavailable
    const internalSession = (sessionMgr as any).sessions.get(session.id);
    internalSession.state = 'unavailable';

    // Should be able to delete
    sessionMgr.delete(session.id);
    expect(mockDb.delete).toHaveBeenCalledWith(session.id);
  });
});