import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  readRuntimeConfig,
  writeRuntimeConfig,
  deleteRuntimeConfig,
  getRuntimePath,
  type RuntimeConfig,
} from './runtime-json.js';

describe('runtime-json', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  const getTestRuntimeDir = () => join(homedir(), '.coder-studio');
  const getTestRuntimePath = () => join(getTestRuntimeDir(), 'runtime.json');

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-runtime-json-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;

    // Clean up before each test
    if (existsSync(getTestRuntimePath())) {
      rmSync(getTestRuntimePath());
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(getTestRuntimePath())) {
      rmSync(getTestRuntimePath());
    }

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  describe('readRuntimeConfig', () => {
    it('should return null when file does not exist', () => {
      const result = readRuntimeConfig();
      expect(result).toBeNull();
    });

    it('should return config when file exists and is valid', () => {
      const config: RuntimeConfig = {
        port: 3000,
        pid: 12345,
        token: 'test-token-123',
        serverInstanceId: 'server-abc',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);
      const result = readRuntimeConfig();

      expect(result).toEqual(config);
    });

    it('should return null when file contains invalid JSON', () => {
      const { writeFileSync } = require('fs');
      mkdirSync(getTestRuntimeDir(), { recursive: true });
      writeFileSync(getTestRuntimePath(), 'invalid json', 'utf-8');

      const result = readRuntimeConfig();
      expect(result).toBeNull();
    });

    it('should return null when required fields are missing', () => {
      const { writeFileSync } = require('fs');
      mkdirSync(getTestRuntimeDir(), { recursive: true });
      writeFileSync(getTestRuntimePath(), JSON.stringify({ port: 3000 }), 'utf-8');

      const result = readRuntimeConfig();
      expect(result).toBeNull();
    });
  });

  describe('writeRuntimeConfig', () => {
    it('should write config to disk', () => {
      const config: RuntimeConfig = {
        port: 3000,
        pid: 12345,
        token: 'test-token-123',
        serverInstanceId: 'server-abc',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);

      expect(existsSync(getTestRuntimePath())).toBe(true);
      const result = readRuntimeConfig();
      expect(result).toEqual(config);
    });

    it('should create directory if it does not exist', () => {
      // Remove directory
      if (existsSync(getTestRuntimeDir())) {
        rmSync(getTestRuntimeDir(), { recursive: true });
      }

      const config: RuntimeConfig = {
        port: 3000,
        token: 'test-token',
        serverInstanceId: 'server-id',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);

      expect(existsSync(getTestRuntimeDir())).toBe(true);
      expect(existsSync(getTestRuntimePath())).toBe(true);
    });
  });

  describe('deleteRuntimeConfig', () => {
    it('should delete file if it exists', () => {
      const config: RuntimeConfig = {
        port: 3000,
        token: 'test-token',
        serverInstanceId: 'server-id',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);
      expect(existsSync(getTestRuntimePath())).toBe(true);

      deleteRuntimeConfig();
      expect(existsSync(getTestRuntimePath())).toBe(false);
    });

    it('should not throw if file does not exist', () => {
      expect(() => deleteRuntimeConfig()).not.toThrow();
    });
  });

  describe('getRuntimePath', () => {
    it('should return correct path', () => {
      const path = getRuntimePath();
      expect(path).toBe(join(homedir(), '.coder-studio', 'runtime.json'));
    });
  });
});
