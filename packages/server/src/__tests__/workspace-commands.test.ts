import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations, closeDatabase } from '../storage/db.js';

// Import command handlers to register them
import '../commands/workspace.js';

describe('Workspace Commands', () => {
  let db: any;
  let ctx: CommandContext;

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(':memory:');
    runMigrations(db);
    ctx = { db };
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

    it('should return list of workspaces', async () => {
      // Create test workspaces
      await db.workspace.create({ path: '/path/to/ws1', targetRuntime: 'node' });
      await db.workspace.create({ path: '/path/to/ws2', targetRuntime: 'bun' });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-2',
          op: 'workspace.list',
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].path).toBe('/path/to/ws1');
      expect(result.data[1].path).toBe('/path/to/ws2');
    });
  });

  describe('workspace.open', () => {
    it('should create new workspace', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-3',
          op: 'workspace.open',
          args: {
            path: '/path/to/workspace',
            targetRuntime: 'node',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data.path).toBe('/path/to/workspace');
      expect(result.data.targetRuntime).toBe('node');
    });

    it('should return existing workspace if already exists', async () => {
      const existing = await db.workspace.create({
        path: '/path/to/existing',
        targetRuntime: 'bun',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-4',
          op: 'workspace.open',
          args: {
            path: '/path/to/existing',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data.id).toBe(existing.id);
    });
  });

  describe('workspace.close', () => {
    it('should delete workspace', async () => {
      const workspace = await db.workspace.create({
        path: '/path/to/close',
        targetRuntime: 'node',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-5',
          op: 'workspace.close',
          args: {
            id: workspace.id,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify workspace is deleted
      const deleted = await db.workspace.findById(workspace.id);
      expect(deleted).toBeUndefined();
    });

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
