import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { SessionManager } from '../session/manager.js';
import { EventBus } from '../bus/event-bus.js';
import { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { providerRegistry } from '@coder-studio/providers';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
      eventBus,
      broadcaster: { broadcast: () => {} } as any,
      providerRegistry: [],
      fencingMgr: {} as any,
      supervisorMgr: {} as any,
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

    it('returns provider_cli_missing before terminal spawn when the CLI is absent', async () => {
      const testDir = join(tmpdir(), `coder-studio-session-command-${Date.now()}`);
      mkdirSync(join(testDir, '.git'), { recursive: true });
      writeFileSync(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

      ctx.providerRegistry = providerRegistry as any;
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command !== 'claude',
      };

      try {
        const openResult = await dispatch(
          {
            kind: 'command',
            id: 'workspace-id',
            op: 'workspace.open',
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: 'command',
            id: 'session-id',
            op: 'session.create',
            args: {
              workspaceId: openResult.data!.id,
              providerId: 'claude',
            },
          },
          ctx
        );

        expect(result.ok).toBe(false);
        expect(result.error).toEqual({
          code: 'provider_cli_missing',
          message: 'Provider CLI is not installed',
          details: {
            providerId: 'claude',
            missingCommands: ['claude'],
          },
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
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
    it('should return unknown_op because the command has been removed', async () => {
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
      expect(result.error?.code).toBe('unknown_op');
    });
  });
});
