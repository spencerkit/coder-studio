import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase, HookRegistrationRepo, type NewHookRegistration } from '../src/storage/index.js';
import type { Database } from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('HookRegistrationRepo', () => {
  let db: Database;
  let repo: HookRegistrationRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hook-registration-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = openDatabase(dbPath);
    repo = new HookRegistrationRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new hook registration', () => {
      const registration: NewHookRegistration = {
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: Date.now(),
        lastStatus: 'ok',
      };

      const result = repo.create(registration);

      expect(result.providerId).toBe('claude-cli');
      expect(result.markerVersion).toBe('v1.0.0');
      expect(result.lastStatus).toBe('ok');
      expect(result.lastError).toBeUndefined();
    });

    it('should create a hook registration with error', () => {
      const registration: NewHookRegistration = {
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: Date.now(),
        lastStatus: 'error',
        lastError: 'Failed to inject hooks: permission denied',
      };

      const result = repo.create(registration);

      expect(result.lastStatus).toBe('error');
      expect(result.lastError).toBe('Failed to inject hooks: permission denied');
    });
  });

  describe('get', () => {
    it('should get a hook registration by provider ID', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: Date.now(),
        lastStatus: 'ok',
      });

      const result = repo.get('claude-cli');

      expect(result).toBeDefined();
      expect(result?.providerId).toBe('claude-cli');
    });

    it('should return undefined for non-existent provider', () => {
      const result = repo.get('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateCheckStatus', () => {
    it('should update check status to ok', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: 1000,
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: 1000,
        lastStatus: 'ok',
      });

      const newCheckAt = Date.now();
      repo.updateCheckStatus('claude-cli', newCheckAt, 'ok');

      const result = repo.get('claude-cli');
      expect(result?.lastCheckAt).toBe(newCheckAt);
      expect(result?.lastStatus).toBe('ok');
    });

    it('should update check status to error with message', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: 1000,
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: 1000,
        lastStatus: 'ok',
      });

      const newCheckAt = Date.now();
      repo.updateCheckStatus('claude-cli', newCheckAt, 'error', 'Marker version mismatch');

      const result = repo.get('claude-cli');
      expect(result?.lastStatus).toBe('error');
      expect(result?.lastError).toBe('Marker version mismatch');
    });
  });

  describe('updateInjection', () => {
    it('should update marker version and injection timestamp', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: 1000,
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: 1000,
        lastStatus: 'ok',
      });

      const newInjectedAt = Date.now();
      repo.updateInjection('claude-cli', 'v2.0.0', newInjectedAt);

      const result = repo.get('claude-cli');
      expect(result?.markerVersion).toBe('v2.0.0');
      expect(result?.injectedAt).toBe(newInjectedAt);
    });
  });

  describe('delete', () => {
    it('should delete a hook registration', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: Date.now(),
        lastStatus: 'ok',
      });

      repo.delete('claude-cli');

      const result = repo.get('claude-cli');
      expect(result).toBeUndefined();
    });

    it('should not throw when deleting non-existent provider', () => {
      expect(() => repo.delete('non-existent')).not.toThrow();
    });
  });

  describe('listAll', () => {
    it('should list all hook registrations', () => {
      repo.create({
        providerId: 'claude-cli',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/path1',
        lastCheckAt: Date.now(),
        lastStatus: 'ok',
      });

      repo.create({
        providerId: 'openai',
        markerVersion: 'v1.0.0',
        injectedAt: Date.now(),
        globalConfigPath: '/path2',
        lastCheckAt: Date.now(),
        lastStatus: 'ok',
      });

      const all = repo.listAll();

      expect(all).toHaveLength(2);
      expect(all.map(r => r.providerId)).toEqual(expect.arrayContaining(['claude-cli', 'openai']));
    });

    it('should return empty array when no registrations exist', () => {
      const all = repo.listAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('workflow scenarios', () => {
    it('should support full hook registration lifecycle', () => {
      const providerId = 'claude-cli';
      const initialTime = Date.now() - 1000;

      // Create initial registration
      repo.create({
        providerId,
        markerVersion: 'v1.0.0',
        injectedAt: initialTime,
        globalConfigPath: '/home/user/.claude/config.json',
        lastCheckAt: initialTime,
        lastStatus: 'ok',
      });

      // Check status - still ok
      const checkTime1 = Date.now() - 500;
      repo.updateCheckStatus(providerId, checkTime1, 'ok');

      // Re-inject hooks with new version
      const reinjectTime = Date.now();
      repo.updateInjection(providerId, 'v1.1.0', reinjectTime);

      // Check status - error
      const checkTime2 = Date.now() + 100;
      repo.updateCheckStatus(providerId, checkTime2, 'error', 'Config file not found');

      // Verify final state
      const result = repo.get(providerId);
      expect(result?.markerVersion).toBe('v1.1.0');
      expect(result?.injectedAt).toBe(reinjectTime);
      expect(result?.lastCheckAt).toBe(checkTime2);
      expect(result?.lastStatus).toBe('error');
      expect(result?.lastError).toBe('Config file not found');
    });
  });
});
