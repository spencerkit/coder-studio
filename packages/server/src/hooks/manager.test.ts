import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { HooksManager } from './manager.js';
import { HookRegistrationRepo } from '../storage/repositories/hook-registration-repo.js';
import type { RuntimeConfig } from './runtime-json.js';
import type { ProviderDefinition, ManagedHooks } from '@coder-studio/core';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('manager', () => {
  let manager: HooksManager;
  let hookRegistrationRepo: HookRegistrationRepo;
  let runtime: RuntimeConfig;
  let db: Database.Database;
  let testDbPath: string;

  const mockProvider: ProviderDefinition = {
    id: 'test-provider',
    displayName: 'Test Provider',
    badge: 'Test',
    capability: 'full',

    buildCommand: () => ({ argv: [], env: {}, cwd: '' }),
    buildResumeCommand: () => null,

    configSchema: {} as any,
    defaultConfig: {},
    requiredCommands: [],

    hooks: {
      markerVersion: 'test-v1',
      resolveGlobalConfigPath: () => join(homedir(), '.test-provider', 'config.json'),
      mergeInto: (existing: unknown, managed: ManagedHooks) => {
        const config =
          existing && typeof existing === 'object' && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};
        return { ...config, hooks: { SessionStart: [{ _cs_managed: true, _cs_version: 'test-v1', command: managed.commands.SessionStart }] } };
      },
      extractManaged: (config: unknown) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
        const hooks = (config as Record<string, unknown>).hooks;
        if (!hooks || typeof hooks !== 'object') return null;
        const arr = (hooks as Record<string, unknown>).SessionStart;
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const h = arr[0] as Record<string, unknown>;
        if (h._cs_managed && typeof h.command === 'string') return { commands: { SessionStart: h.command } };
        return null;
      },
      bridgeCommand: (bridgeScriptPath: string, event: string) => ['node', bridgeScriptPath, event],
      parseEvent: () => null,
      events: { sessionStart: true, completion: true, progress: false },
    },
  };

  beforeEach(() => {
    testDbPath = join(tmpdir(), `test-${Date.now()}.db`);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE hook_registrations (
        provider_id TEXT PRIMARY KEY,
        marker_version TEXT NOT NULL,
        injected_at INTEGER NOT NULL,
        global_config_path TEXT NOT NULL,
        last_check_at INTEGER NOT NULL,
        last_status TEXT NOT NULL,
        last_error TEXT
      );
    `);
    hookRegistrationRepo = new HookRegistrationRepo(db);
    runtime = { port: 3000, token: 'test-token', serverInstanceId: 'server-abc', startedAt: Date.now() };
    manager = new HooksManager(hookRegistrationRepo, runtime);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) rmSync(testDbPath);
    const backupDir = join(homedir(), '.coder-studio', 'backups');
    if (existsSync(backupDir)) rmSync(backupDir, { recursive: true });
  });

  describe('ensureGlobalConfig', () => {
    it('should deploy bridge script and update config', async () => {
      await manager.ensureGlobalConfig(mockProvider);
      const bridgePath = join(homedir(), '.coder-studio', 'hooks', 'test-provider-bridge.js');
      expect(existsSync(bridgePath)).toBe(true);
      const registration = hookRegistrationRepo.get('test-provider');
      expect(registration).toBeDefined();
      expect(registration!.providerId).toBe('test-provider');
      expect(registration!.markerVersion).toBe('test-v1');
      expect(registration!.lastStatus).toBe('ok');
    });

    it('should track errors in database', async () => {
      const invalidProvider = {
        ...mockProvider,
        hooks: { ...mockProvider.hooks, resolveGlobalConfigPath: () => '/invalid/path/config.json' },
      };
      await manager.ensureGlobalConfig(invalidProvider);
      const registration = hookRegistrationRepo.get('test-provider');
      expect(registration).toBeDefined();
      expect(registration!.lastStatus).toBe('error');
      expect(registration!.lastError).toBeDefined();
    });

    it('should update existing registration on re-run', async () => {
      await manager.ensureGlobalConfig(mockProvider);
      const first = hookRegistrationRepo.get('test-provider');
      expect(first).toBeDefined();
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.ensureGlobalConfig(mockProvider);
      const second = hookRegistrationRepo.get('test-provider');
      expect(second).toBeDefined();
      expect(second!.injectedAt).toBeGreaterThanOrEqual(first!.injectedAt);
    });
  });

  describe('handleHookEvent', () => {
    it('routes Codex agent-turn-complete to SessionManager via query sessionId', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      const providerRegistry = [
        {
          id: 'codex',
          hooks: {
            parseEvent: (event: string, payload: any) =>
              event === 'agent-turn-complete'
                ? { type: 'turn_completed', sessionId: '', payload: { resumeId: payload['thread-id'], turnId: payload['turn-id'] } }
                : null,
          },
        } as any,
      ];
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry,
        sessionDb: { findByResumeId: vi.fn() },
      });

      manager.handleHookEvent('agent-turn-complete', {
        type: 'agent-turn-complete',
        'thread-id': 'uuid-1',
        'turn-id': 'turn-1',
      }, { coderStudioSessionId: 'cs-1' });

      expect(sessionMgr.onHookEvent).toHaveBeenCalledWith('cs-1', {
        kind: 'TurnCompleted',
        resumeId: 'uuid-1',
        turnId: 'turn-1',
      });
    });

    it('routes Claude SessionStart via payload.session_id reverse lookup', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      const sessionDb = {
        findByResumeId: vi.fn().mockReturnValue({ id: 'cs-claude-1' }),
      };
      const providerRegistry = [
        {
          id: 'claude',
          hooks: {
            parseEvent: (event: string, payload: any) =>
              event === 'SessionStart'
                ? { type: 'session_start', sessionId: payload.session_id, payload: { resumeId: payload.session_id, transcriptPath: payload.transcript_path } }
                : null,
          },
        } as any,
      ];
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry,
        sessionDb: sessionDb as any,
      });

      manager.handleHookEvent('SessionStart', {
        session_id: 'claude-abc',
        transcript_path: '/x.jsonl',
      }, {});

      expect(sessionDb.findByResumeId).toHaveBeenCalledWith('claude-abc');
      expect(sessionMgr.onHookEvent).toHaveBeenCalledWith('cs-claude-1', {
        kind: 'SessionStart',
        resumeId: 'claude-abc',
        transcriptPath: '/x.jsonl',
      });
    });

    it('no-ops when no provider parses the event', () => {
      const sessionMgr = { onHookEvent: vi.fn() };
      manager = new HooksManager(hookRegistrationRepo, runtime, {
        sessionMgr: sessionMgr as any,
        providerRegistry: [],
        sessionDb: { findByResumeId: vi.fn() },
      });

      manager.handleHookEvent('unknown', {}, {});
      expect(sessionMgr.onHookEvent).not.toHaveBeenCalled();
    });
  });
});
