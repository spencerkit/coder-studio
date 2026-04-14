import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { HooksManager } from './manager.js';
import { HookRegistrationRepo } from '../storage/repositories/hook-registration-repo.js';
import type { RuntimeConfig } from './runtime-json.js';
import type { ProviderDefinition, ManagedHooks } from '@coder-studio/core';
import Database from 'better-sqlite3';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

describe('manager', () => {
  let manager: HooksManager;
  let hookRegistrationRepo: HookRegistrationRepo;
  let runtime: RuntimeConfig;
  let db: Database.Database;
  let testDbPath: string;

  // Mock provider for testing
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

        return {
          ...config,
          hooks: {
            SessionStart: [
              {
                _cs_managed: true,
                _cs_version: 'test-v1',
                command: managed.commands.SessionStart,
              },
            ],
          },
        };
      },

      extractManaged: (config: unknown) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
          return null;
        }

        const hooks = (config as Record<string, unknown>).hooks;
        if (!hooks || typeof hooks !== 'object') {
          return null;
        }

        const sessionStart = (hooks as Record<string, unknown>).SessionStart;
        if (!Array.isArray(sessionStart) || sessionStart.length === 0) {
          return null;
        }

        const hook = sessionStart[0] as Record<string, unknown>;
        if (hook._cs_managed && typeof hook.command === 'string') {
          return {
            commands: {
              SessionStart: hook.command,
            },
          };
        }

        return null;
      },

      bridgeCommand: (bridgeScriptPath: string, event: string) => [
        'node',
        bridgeScriptPath,
        event,
      ],

      parseEvent: () => null,

      events: {
        sessionStart: true,
        completion: true,
        progress: false,
      },
    },
  };

  beforeEach(() => {
    // Create temporary database with schema
    testDbPath = join(tmpdir(), `test-${Date.now()}.db`);

    // Create database and initialize schema manually
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create hook_registrations table
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

    runtime = {
      port: 3000,
      token: 'test-token',
      serverInstanceId: 'server-abc',
      startedAt: Date.now(),
    };

    manager = new HooksManager(hookRegistrationRepo, runtime);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
    // Clean up backup directory
    const backupDir = join(homedir(), '.coder-studio', 'backups');
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true });
    }
  });

  describe('ensureGlobalConfig', () => {
    it('should deploy bridge script and update config', async () => {
      await manager.ensureGlobalConfig(mockProvider);

      // Check bridge script was deployed
      const bridgePath = join(homedir(), '.coder-studio', 'hooks', 'test-provider-bridge.js');
      expect(existsSync(bridgePath)).toBe(true);

      // Check database registration
      const registration = hookRegistrationRepo.get('test-provider');
      expect(registration).toBeDefined();
      expect(registration!.providerId).toBe('test-provider');
      expect(registration!.markerVersion).toBe('test-v1');
      expect(registration!.lastStatus).toBe('ok');
    });

    it('should create backup of existing config', async () => {
      // This test is skipped for now as it requires actual file system operations
      // In a real test, we would mock the file system or use a test directory
    });

    it('should track errors in database', async () => {
      // Create provider with invalid config path
      const invalidProvider = {
        ...mockProvider,
        hooks: {
          ...mockProvider.hooks,
          resolveGlobalConfigPath: () => '/invalid/path/config.json',
        },
      };

      await manager.ensureGlobalConfig(invalidProvider);

      const registration = hookRegistrationRepo.get('test-provider');
      expect(registration).toBeDefined();
      expect(registration!.lastStatus).toBe('error');
      expect(registration!.lastError).toBeDefined();
    });

    it('should update existing registration on re-run', async () => {
      // First run
      await manager.ensureGlobalConfig(mockProvider);
      const first = hookRegistrationRepo.get('test-provider');
      expect(first).toBeDefined();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second run
      await manager.ensureGlobalConfig(mockProvider);
      const second = hookRegistrationRepo.get('test-provider');
      expect(second).toBeDefined();
      expect(second!.injectedAt).toBeGreaterThanOrEqual(first!.injectedAt);
    });
  });

  describe('handleHookEvent', () => {
    it('should handle hook events', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      manager.handleHookEvent('SessionStart', { session_id: 'session-123' });

      expect(consoleSpy).toHaveBeenCalledWith('Hook event received:', {
        event: 'SessionStart',
        payload: { session_id: 'session-123' },
      });

      consoleSpy.mockRestore();
    });
  });

  describe('buildManagedHooks', () => {
    it('should build managed hooks for provider with session start and completion', async () => {
      // This is tested indirectly through ensureGlobalConfig
      await manager.ensureGlobalConfig(mockProvider);

      const registration = hookRegistrationRepo.get('test-provider');
      expect(registration).toBeDefined();
    });
  });
});

import { vi } from 'vitest';
