import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { SessionManager } from '../session/manager.js';
import { EventBus } from '../bus/event-bus.js';
import { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';

// Import command handlers to register them
import '../commands/workspace.js';
import '../commands/session.js';

describe('Session Commands', () => {
  let db: ReturnType<typeof openDatabase>;
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(':memory:');
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();

    // Create managers
    workspaceMgr = new WorkspaceManager({ db, eventBus });
    sessionMgr = new SessionManager({
      terminalMgr: {
        create: () => ({ id: 'terminal-1' }),
        kill: () => {},
      } as any,
      eventBus,
      db: {
        insert: () => {},
        update: () => {},
        delete: () => {},
      } as any,
      broadcaster: { broadcast: () => {} } as any,
      providerRegistry: [],
      providerConfigRepo: new ProviderConfigRepo(db),
    });

    // Create context with required dependencies
    ctx = {
      db,
      workspaceMgr,
      sessionMgr,
      terminalMgr: {} as any,
      hooksMgr: {} as any,
      eventBus,
      broadcaster: { broadcast: () => {} } as any,
      providerRegistry: [],
    };
  });

  describe('session.create', () => {
    it('should error if workspace not found', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-2',
          op: 'session.create',
          args: {
            workspaceId: 'non-existent-id',
            providerId: 'claude-code',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('session.stop', () => {
    it('should error if session not found', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-5',
          op: 'session.stop',
          args: {
            sessionId: 'non-existent-id',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('session.remove', () => {
    it('should error if session not found', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-6',
          op: 'session.remove',
          args: {
            sessionId: 'non-existent-id',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('session.resume', () => {
    it('should error if session not found', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-8',
          op: 'session.resume',
          args: {
            sessionId: 'non-existent-id',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });
});
