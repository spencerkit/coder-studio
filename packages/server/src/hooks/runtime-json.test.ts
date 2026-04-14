import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  readRuntimeConfig,
  writeRuntimeConfig,
  deleteRuntimeConfig,
  getRuntimePath,
  type RuntimeConfig,
} from './runtime-json.js';

describe('runtime-json', () => {
  const testRuntimeDir = join(homedir(), '.coder-studio');
  const testRuntimePath = join(testRuntimeDir, 'runtime.json');

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testRuntimePath)) {
      rmSync(testRuntimePath);
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testRuntimePath)) {
      rmSync(testRuntimePath);
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
      writeFileSync(testRuntimePath, 'invalid json', 'utf-8');

      const result = readRuntimeConfig();
      expect(result).toBeNull();
    });

    it('should return null when required fields are missing', () => {
      const { writeFileSync } = require('fs');
      writeFileSync(testRuntimePath, JSON.stringify({ port: 3000 }), 'utf-8');

      const result = readRuntimeConfig();
      expect(result).toBeNull();
    });
  });

  describe('writeRuntimeConfig', () => {
    it('should write config to disk', () => {
      const config: RuntimeConfig = {
        port: 3000,
        token: 'test-token-123',
        serverInstanceId: 'server-abc',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);

      expect(existsSync(testRuntimePath)).toBe(true);
      const result = readRuntimeConfig();
      expect(result).toEqual(config);
    });

    it('should create directory if it does not exist', () => {
      // Remove directory
      if (existsSync(testRuntimeDir)) {
        rmSync(testRuntimeDir, { recursive: true });
      }

      const config: RuntimeConfig = {
        port: 3000,
        token: 'test-token',
        serverInstanceId: 'server-id',
        startedAt: Date.now(),
      };

      writeRuntimeConfig(config);

      expect(existsSync(testRuntimeDir)).toBe(true);
      expect(existsSync(testRuntimePath)).toBe(true);
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
      expect(existsSync(testRuntimePath)).toBe(true);

      deleteRuntimeConfig();
      expect(existsSync(testRuntimePath)).toBe(false);
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
