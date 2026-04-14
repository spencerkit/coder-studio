import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { openDatabase, runMigrations } from '../storage/db.js';

// Import command handlers to register them
import '../commands/workspace.js';
import '../commands/session.js';

describe('Session Commands', () => {
  let db: any;
  let ctx: CommandContext;
  let testWorkspace: any;

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(':memory:');
    runMigrations(db);
    ctx = { db };

    // Create test workspace
    testWorkspace = db.workspace.create({
      path: '/test/workspace',
      targetRuntime: 'node',
    });
  });

  describe('session.create', () => {
    it('should create new session', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-1',
          op: 'session.create',
          args: {
            workspaceId: testWorkspace.id,
            providerId: 'claude-code',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data.workspaceId).toBe(testWorkspace.id);
      expect(result.data.providerId).toBe('claude-code');
      expect(result.data.state).toBe('idle');
    });

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
      expect(result.error?.code).toBe('internal_error');
    });

    it('should create session with draft', async () => {
      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-3',
          op: 'session.create',
          args: {
            workspaceId: testWorkspace.id,
            providerId: 'claude-code',
            draft: 'Initial prompt',
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data.draft).toBe('Initial prompt');
    });
  });

  describe('session.stop', () => {
    it('should stop session', async () => {
      const session = await db.session.create({
        workspaceId: testWorkspace.id,
        providerId: 'claude-code',
        state: 'running',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-4',
          op: 'session.stop',
          args: {
            sessionId: session.id,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify session is stopped
      const updated = await db.session.findById(session.id);
      expect(updated.state).toBe('stopped');
    });

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
    it('should remove stopped session', async () => {
      const session = await db.session.create({
        workspaceId: testWorkspace.id,
        providerId: 'claude-code',
        state: 'stopped',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-6',
          op: 'session.remove',
          args: {
            sessionId: session.id,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify session is deleted
      const deleted = await db.session.findById(session.id);
      expect(deleted).toBeUndefined();
    });

    it('should not remove running session', async () => {
      const session = await db.session.create({
        workspaceId: testWorkspace.id,
        providerId: 'claude-code',
        state: 'running',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-7',
          op: 'session.remove',
          args: {
            sessionId: session.id,
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('Cannot remove session in state');

      // Verify session still exists
      const existing = await db.session.findById(session.id);
      expect(existing).toBeDefined();
    });
  });

  describe('session.resume', () => {
    it('should resume stopped session', async () => {
      const session = await db.session.create({
        workspaceId: testWorkspace.id,
        providerId: 'claude-code',
        state: 'stopped',
      });

      const result = await dispatch(
        {
          kind: 'command',
          id: 'test-id-8',
          op: 'session.resume',
          args: {
            sessionId: session.id,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);

      // Verify session is running
      const updated = await db.session.findById(session.id);
      expect(updated.state).toBe('running');
    });
  });
});
