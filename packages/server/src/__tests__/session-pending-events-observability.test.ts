/**
 * Tests for SessionManager pending events observability
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager, type SessionLogger, type SessionManagerDeps } from '../session/manager.js';
import type { EventBus } from '../bus/event-bus.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { Broadcaster } from '../ws/hub.js';

describe('SessionManager pending events observability', () => {
  let sessionMgr: SessionManager;
  let mockDb: {
    insert: vi.Mock;
    update: vi.Mock;
    findById: vi.Mock;
    findByWorkspaceId: vi.Mock;
    delete: vi.Mock;
    listHydratable: vi.Mock;
  };
  let mockEventBus: {
    emit: vi.Mock;
    on: vi.Mock;
  };
  let mockTerminalMgr: {
    create: vi.Mock;
    kill: vi.Mock;
  };
  let mockLogger: SessionLogger & {
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn(),
      delete: vi.fn(),
      listHydratable: vi.fn().mockReturnValue([]),
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

    mockLogger = {
      warn: vi.fn(),
    };

    const deps: SessionManagerDeps = {
      terminalMgr: mockTerminalMgr as any,
      eventBus: mockEventBus as any,
      db: mockDb as any,
      broadcaster: {} as Broadcaster,
      providerRegistry: [],
      providerConfigRepo: { get: vi.fn(() => undefined) } as any,
      logger: mockLogger,
    };

    sessionMgr = new SessionManager(deps);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onHookEvent pending pool logging', () => {
    it('should log when hook event is added to pending pool for unregistered session', () => {
      const sessionId = 'sess-unregistered';
      const event = { kind: 'SessionStart', resumeId: 'resume-123' };

      sessionMgr.onHookEvent(sessionId, event);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          eventKind: 'SessionStart',
        }),
        '[SessionManager] Hook event queued'
      );
    });

    it('should not log when hook event is applied directly to registered session', async () => {
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

      mockLogger.warn.mockClear();

      sessionMgr.onHookEvent(session.id, { kind: 'Stop' });

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        '[SessionManager] Hook event queued'
      );
    });
  });

  describe('scheduleCleanup expired events logging', () => {
    it('should log when expired pending events are cleaned up', () => {
      const sessionId = 'sess-expired';
      sessionMgr.onHookEvent(sessionId, { kind: 'SessionStart', resumeId: 'resume-old' });

      mockLogger.warn.mockClear();

      const pendingEvents = (sessionMgr as any).pendingEvents;
      const pending = pendingEvents.get(sessionId);
      if (pending) {
        pending.expiresAt = Date.now() - 10000;
      }

      sessionMgr.onHookEvent('sess-other', { kind: 'Stop' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          cleanedSessionIds: expect.arrayContaining([sessionId]),
        }),
        '[SessionManager] Expired pending events cleaned'
      );
    });

    it('should not log when no expired pending events exist', () => {
      const sessionId = 'sess-fresh';
      sessionMgr.onHookEvent(sessionId, { kind: 'SessionStart', resumeId: 'resume-new' });

      mockLogger.warn.mockClear();

      sessionMgr.onHookEvent('sess-other', { kind: 'Stop' });

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        '[SessionManager] Expired pending events cleaned'
      );
    });
  });
});
