import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mergeWriteConfig, readConfigFile } from './merge-writer.js';
import type { HooksDescriptor, ManagedHooks } from '@coder-studio/core';

describe('merge-writer', () => {
  let testDir: string;
  let testConfigPath: string;
  let testBackupDir: string;

  // Mock hooks descriptor for testing
  const mockHooksDescriptor: HooksDescriptor = {
    markerVersion: 'test-v1',

    resolveGlobalConfigPath: () => testConfigPath,

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

    bridgeCommand: () => [],
    parseEvent: () => null,
    events: { sessionStart: false, completion: false, progress: false },
  };

  beforeEach(() => {
    testDir = join(tmpdir(), `merge-writer-test-${Date.now()}`);
    testConfigPath = join(testDir, 'test-config.json');
    testBackupDir = join(testDir, 'backups');

    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('mergeWriteConfig', () => {
    it('should create new config if it does not exist', () => {
      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      expect(existsSync(testConfigPath)).toBe(true);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.hooks.SessionStart).toBeDefined();
      expect(config.hooks.SessionStart[0]._cs_managed).toBe(true);
    });

    it('should preserve existing user configuration', () => {
      // Create existing config with user settings
      const existingConfig = {
        model: 'claude-opus-4',
        maxTurns: 10,
        customSetting: 'user-value',
      };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(existingConfig, null, 2));

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      // User settings should be preserved
      expect(config.model).toBe('claude-opus-4');
      expect(config.maxTurns).toBe(10);
      expect(config.customSetting).toBe('user-value');
      // Managed hooks should be added
      expect(config.hooks.SessionStart).toBeDefined();
    });

    it('should backup existing config before modifying', () => {
      const existingConfig = { model: 'claude-opus-4' };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(existingConfig, null, 2));

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(existsSync(result.backupPath!)).toBe(true);

      const backup = JSON.parse(readFileSync(result.backupPath!, 'utf-8'));
      expect(backup).toEqual(existingConfig);
    });

    it('should skip if already up to date', () => {
      // Create config with current version
      const configWithManagedHooks = {
        hooks: {
          SessionStart: [
            {
              _cs_managed: true,
              _cs_version: 'test-v1',
              command: 'node /same/path/bridge.js SessionStart',
            },
          ],
        },
      };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(configWithManagedHooks, null, 2));

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /same/path/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeUndefined(); // No backup needed

      // Config should remain unchanged
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.hooks.SessionStart[0].command).toBe('node /same/path/bridge.js SessionStart');
    });

    it('should rewrite when managed command drifts even if a managed hook already exists', () => {
      const configWithManagedHooks = {
        hooks: {
          SessionStart: [
            {
              _cs_managed: true,
              _cs_version: 'test-v1',
              command: 'node /old/path/bridge.js SessionStart',
            },
          ],
        },
      };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(configWithManagedHooks, null, 2));

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /new/path/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.hooks.SessionStart[0].command).toBe('node /new/path/bridge.js SessionStart');
    });

    it('should rewrite when the stored managed marker version is stale', () => {
      const configWithManagedHooks = {
        hooks: {
          SessionStart: [
            {
              _cs_managed: true,
              _cs_version: 'test-v0',
              command: 'node /same/path/bridge.js SessionStart',
            },
          ],
        },
      };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(configWithManagedHooks, null, 2));

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /same/path/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();

      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.hooks.SessionStart[0]._cs_version).toBe('test-v1');
    });

    it('should handle malformed existing config', () => {
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, 'invalid json', 'utf-8');

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        testConfigPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(true);
      const config = JSON.parse(readFileSync(testConfigPath, 'utf-8'));
      expect(config.hooks.SessionStart).toBeDefined();
    });

    it('should return error on failure', () => {
      const invalidPath = '/invalid/path/that/does/not/exist/config.json';

      const managedHooks: ManagedHooks = {
        commands: {
          SessionStart: 'node /path/to/bridge.js SessionStart',
        },
      };

      const result = mergeWriteConfig(
        invalidPath,
        mockHooksDescriptor,
        managedHooks,
        testBackupDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('readConfigFile', () => {
    it('should return null for non-existent file', () => {
      const result = readConfigFile('/non/existent/file.json');
      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, 'invalid json', 'utf-8');

      const result = readConfigFile(testConfigPath);
      expect(result).toBeNull();
    });

    it('should parse valid JSON', () => {
      const config = { model: 'claude-opus-4' };
      mkdirSync(dirname(testConfigPath), { recursive: true });
      require('fs').writeFileSync(testConfigPath, JSON.stringify(config), 'utf-8');

      const result = readConfigFile(testConfigPath);
      expect(result).toEqual(config);
    });
  });
});

// Helper function
function dirname(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
