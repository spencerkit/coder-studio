/**
 * Tests for WorkspaceManager.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { WorkspaceManager } from '../../workspace/manager.js';
import { openDatabase } from '../../storage/db.js';
import type { DomainEvent } from '@coder-studio/core';

describe('WorkspaceManager', () => {
  let testDir: string;
  let db: Database.Database;
  let manager: WorkspaceManager;
  let events: DomainEvent[];

  beforeEach(async () => {
    // Create test directory
    testDir = join(tmpdir(), `workspace-test-${Date.now()}`);
    await mkdir(testDir);

    // Create in-memory database
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        target_runtime TEXT NOT NULL,
        wsl_distro TEXT,
        opened_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        ui_state TEXT
      );
    `);

    // Event bus mock
    events = [];
    const eventBus = {
      emit: (event: DomainEvent) => {
        events.push(event);
      },
      on: () => () => {},
    };

    manager = new WorkspaceManager({ db, eventBus });
  });

  afterEach(async () => {
    try {
      db.close();
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('open', () => {
    it('should open a valid workspace', async () => {
      const workspace = await manager.open({
        path: testDir,
      });

      expect(workspace.id).toBeDefined();
      expect(workspace.path).toBe(testDir);
      expect(workspace.openedAt).toBeDefined();
      expect(workspace.uiState).toBeDefined();
    });

    it('should emit workspace.meta.changed event', async () => {
      await manager.open({
        path: testDir,
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('workspace.meta.changed');
    });

    it('should reject non-existent path', async () => {
      await expect(
        manager.open({
          path: join(testDir, 'nonexistent'),
        })
      ).rejects.toThrow();
    });

    it('should return existing workspace for duplicate paths (idempotent open)', async () => {
      const first = await manager.open({
        path: testDir,
      });

      const second = await manager.open({
        path: testDir,
      });

      // Should return the same workspace
      expect(second.id).toBe(first.id);
      expect(second.path).toBe(first.path);
    });
  });

  describe('list', () => {
    it('should list all workspaces', async () => {
      await manager.open({ path: testDir });

      const workspaces = manager.list();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].path).toBe(testDir);
    });

    it('should return empty array when no workspaces', () => {
      const workspaces = manager.list();
      expect(workspaces).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should get workspace by id', async () => {
      const created = await manager.open({ path: testDir });
      const workspace = manager.get(created.id);

      expect(workspace).toBeDefined();
      expect(workspace?.id).toBe(created.id);
    });

    it('should return undefined for non-existent workspace', () => {
      const workspace = manager.get('nonexistent');
      expect(workspace).toBeUndefined();
    });
  });

  describe('close', () => {
    it('should close workspace', async () => {
      const workspace = await manager.open({ path: testDir });
      await manager.close(workspace.id);

      const workspaces = manager.list();
      expect(workspaces).toHaveLength(0);
    });

    it('should throw for non-existent workspace', async () => {
      await expect(manager.close('nonexistent')).rejects.toThrow();
    });
  });

  describe('touch', () => {
    it('should update last active timestamp', async () => {
      const workspace = await manager.open({ path: testDir });
      const originalLastActive = workspace.lastActiveAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.touch(workspace.id);

      const updated = manager.get(workspace.id);
      expect(updated?.lastActiveAt).toBeGreaterThan(originalLastActive);
    });
  });
});
