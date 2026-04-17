import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { EventBus } from '../bus/event-bus.js';

// Import command handlers to register them
import '../commands/workspace.js';

describe('Workspace Commands', () => {
  let db: ReturnType<typeof openDatabase>;
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(':memory:');
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();

    // Create workspace manager
    workspaceMgr = new WorkspaceManager({ db, eventBus });

    // Create context with required dependencies
    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {} as any,
      terminalMgr: {} as any,
      hooksMgr: {} as any,
      eventBus,
      broadcaster: { broadcast: () => {} } as any,
      providerRegistry: [],
    };
  });

  describe('workspace.list', () => {
    it('should return empty array when no workspaces exist', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-1',
          op: 'workspace.list',
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('workspace.open', () => {
    it('should fail for non-existent path', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-3',
          op: 'workspace.open',
          args: {
            path: '/non/existent/path/that/does/not/exist',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('workspace.close', () => {
    it('should error if workspace not found', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-6',
          op: 'workspace.close',
          args: {
            id: 'non-existent-id',
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('internal_error');
    });
  });
});
