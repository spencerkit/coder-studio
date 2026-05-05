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
    if (db?.isOpen) {
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
      expect(result[0]?.integrity_check).toBe('ok');
    });

    it('should not create the migrations table', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
      expect(result).toBeUndefined();
    });

    it('should keep the schema stable on subsequent opens', () => {
      const dbPath = join(tempDir, 'test.db');

      db = openDatabase(dbPath);
      closeDatabase(db);

      db = openDatabase(dbPath);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'auth_login_blocks',
          'auth_login_failures',
          'auth_sessions',
          'provider_configs',
          'sessions',
          'supervisor_cycles',
          'supervisors',
          'terminals',
          'user_settings',
          'workspaces',
        ])
      );
      expect(tables.map((table) => table.name)).not.toContain('_migrations');
    });

    it('should create all required tables', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((table) => table.name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          'workspaces',
          'terminals',
          'sessions',
          'provider_configs',
          'user_settings',
          'auth_sessions',
          'supervisors',
          'supervisor_cycles',
          'auth_login_blocks',
          'auth_login_failures',
        ])
      );
    });

    it('should create required indexes', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as { name: string }[];
      const indexNames = indexes.map((index) => index.name);

      expect(indexNames).toEqual(
        expect.arrayContaining([
          'idx_terminals_workspace',
          'idx_terminals_kind',
          'idx_sessions_workspace',
          'idx_sessions_terminal',
          'idx_sessions_id_workspace',
          'idx_auth_sessions_last_seen_at',
          'idx_supervisors_workspace',
          'idx_supervisors_session',
          'idx_supervisors_id_session',
          'idx_supervisor_cycles_supervisor',
          'idx_supervisor_cycles_session',
          'idx_auth_login_blocks_blocked_until',
          'idx_auth_login_failures_ip_failed_at',
        ])
      );
    });

    it('should support foreign key constraints', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);

      db.prepare('INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)').run(
        'ws-1',
        '/path',
        'native',
        Date.now(),
        Date.now(),
        '{}'
      );

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

      db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');

      const terminal = db.prepare('SELECT * FROM terminals WHERE id = ?').get('t-1');
      expect(terminal).toBeUndefined();
    });
  });

  describe('closeDatabase', () => {
    it('should close the database connection', () => {
      const dbPath = join(tempDir, 'test.db');
      db = openDatabase(dbPath);
      closeDatabase(db);

      expect(() => {
        db.prepare('SELECT 1').get();
      }).toThrow();
    });
  });
});
