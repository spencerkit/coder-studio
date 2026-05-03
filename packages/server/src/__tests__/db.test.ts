import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../storage/index.js';
import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('Database', () => {
  let db: DatabaseSync;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'db-test-'));
  });

  afterEach(() => {
    if (db) {
      closeDatabase(db);
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('openDatabase', () => {
    it('should open a database and enable WAL mode', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(result.journal_mode).toBe('wal');
    });

    it('should enable foreign key constraints', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
    });

    it('should run integrity check successfully', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const result = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      expect(result[0].integrity_check).toBe('ok');
    });

    it('should create the migrations table', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();

      expect(result).toBeDefined();
    });

    it('should run initial migration', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const migration = db.prepare('SELECT * FROM _migrations WHERE name = ?').get('001_init') as
        | { name: string }
        | undefined;

      expect(migration).toBeDefined();
      expect(migration?.name).toBe('001_init');
    });

    it('should not re-run migrations on subsequent opens', () => {
      const dbPath = join(tempDir, 'test.db');

      // Open and close
      db = openDatabase(dbPath);
      closeDatabase(db);

      // Reopen
      db = openDatabase(dbPath);

      // Should only have one migration record
      const migrations = db.prepare('SELECT COUNT(*) as count FROM _migrations').get() as { count: number };
      expect(migrations.count).toBeGreaterThanOrEqual(1);
    });

    it('should create all required tables', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('workspaces');
      expect(tableNames).toContain('terminals');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('provider_configs');
      expect(tableNames).toContain('user_settings');
      expect(tableNames).toContain('auth_sessions');
    });

    it('should create required indexes', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as { name: string }[];
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_terminals_workspace');
      expect(indexNames).toContain('idx_terminals_kind');
      expect(indexNames).toContain('idx_sessions_workspace');
      expect(indexNames).toContain('idx_sessions_terminal');
    });

    it('should support foreign key constraints', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      // Create a workspace
      db.prepare('INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)').run(
        'ws-1',
        '/path',
        'native',
        Date.now(),
        Date.now(),
        '{}'
      );

      // Try to create a terminal with non-existent workspace (should fail)
      expect(() => {
        db.prepare('INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          't-1',
          'non-existent-workspace',
          'agent',
          '/path',
          '[]',
          80,
          24,
          Date.now()
        );
      }).toThrow();
    });

    it('should cascade delete terminals when workspace is deleted', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      // Create workspace and terminal
      db.prepare('INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)').run(
        'ws-1',
        '/path',
        'native',
        Date.now(),
        Date.now(),
        '{}'
      );

      db.prepare('INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        't-1',
        'ws-1',
        'agent',
        '/path',
        '[]',
        80,
        24,
        Date.now()
      );

      // Delete workspace
      db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');

      // Verify terminal was deleted
      const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get('t-1');
      expect(terminal).toBeUndefined();
    });
  });

  describe('closeDatabase', () => {
    it('should close the database connection', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);
      closeDatabase(db);

      // Trying to use a closed database should throw
      expect(() => {
        db.prepare('SELECT 1').get();
      }).toThrow();
    });
  });
});
