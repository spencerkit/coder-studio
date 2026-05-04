import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('runMigrations', () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'coder-studio-test-'));
    dbPath = join(dbDir, 'test.db');
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('applies all sequentially-numbered migrations in order', async () => {
    const { runMigrations, closeDatabase } = await import('./db');

    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const migrations = db.prepare('SELECT name, applied_at FROM _migrations ORDER BY id').all();
    expect(migrations.length).toBeGreaterThanOrEqual(1);

    const names = migrations.map((m: { name: string }) => m.name);
    const sortedNames = [...names].sort();
    expect(names).toEqual(sortedNames);

    const initMigration = migrations.find((m: { name: string }) => m.name === '001_init');
    expect(initMigration).toBeDefined();
    expect((initMigration as { applied_at: number }).applied_at).toBeGreaterThan(0);

    closeDatabase(db);
  });

  it('is idempotent — running twice does not re-apply migrations', async () => {
    const { runMigrations } = await import('./db');

    const db = new DatabaseSync(dbPath);

    runMigrations(db);
    const firstRunMigrations = db.prepare('SELECT name, applied_at FROM _migrations ORDER BY id').all();

    const firstRunTimestamps = new Map(
      (firstRunMigrations as Array<{ name: string; applied_at: number }>).map(m => [m.name, m.applied_at])
    );

    runMigrations(db);
    const secondRunMigrations = db.prepare('SELECT name, applied_at FROM _migrations ORDER BY id').all();

    expect(secondRunMigrations.length).toBe(firstRunMigrations.length);

    for (const migration of secondRunMigrations as Array<{ name: string; applied_at: number }>) {
      const originalTimestamp = firstRunTimestamps.get(migration.name);
      expect(migration.applied_at).toBe(originalTimestamp);
    }

    db.close();
  });

  it('migration 006 drops legacy resume and transcript columns from sessions', async () => {
    const { runMigrations } = await import('./db');

    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    expect(cols.find(c => c.name === 'resume_id')).toBeUndefined();
    expect(cols.find(c => c.name === 'transcript_path')).toBeUndefined();

    db.close();
  });

  it('upgrades a pre-006 database with legacy session columns and hook registrations intact', async () => {
    const { runMigrations } = await import('./db');

    const db = new DatabaseSync(dbPath);
    const migrationsDir = join(import.meta.dirname, 'migrations');

    for (const file of ['001_init.sql', '002_transcript_path.sql', '003_supervisors.sql', '004_session_title.sql', '005_auth_sessions.sql']) {
      db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      );
    `);

    for (const [index, name] of ['001_init', '002_transcript_path', '003_supervisors', '004_session_title', '005_auth_sessions'].entries()) {
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(index + 1, name, 1000 + index);
    }

    db.prepare('INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)').run(
      'ws-1',
      '/workspace',
      'native',
      1,
      1,
      '{}'
    );
    db.prepare('INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'term-1',
      'ws-1',
      'agent',
      '/workspace',
      '[]',
      80,
      24,
      1
    );
    db.prepare(`
      INSERT INTO sessions (
        id, workspace_id, terminal_id, provider_id, resume_id, capability, state,
        started_at, ended_at, last_active_at, completion_percent, error_reason,
        archived, transcript_path, title
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-1',
      'ws-1',
      'term-1',
      'claude',
      'resume-1',
      'full',
      'ended',
      1,
      2,
      1,
      null,
      null,
      0,
      '/tmp/transcript.jsonl',
      'title'
    );
    db.prepare(`
      INSERT INTO hook_registrations (
        provider_id, marker_version, injected_at, global_config_path, last_check_at, last_status, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('claude', 'v1', 1, '/tmp/settings.json', 1, 'ok', null);

    runMigrations(db);

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    expect(cols.find((c) => c.name === 'resume_id')).toBeUndefined();
    expect(cols.find((c) => c.name === 'transcript_path')).toBeUndefined();

    const session = db.prepare('SELECT id, provider_id, state, title FROM sessions WHERE id = ?').get('sess-1') as {
      id: string;
      provider_id: string;
      state: string;
      title: string | null;
    };
    expect(session).toEqual({
      id: 'sess-1',
      provider_id: 'claude',
      state: 'ended',
      title: 'title',
    });

    const hookTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hook_registrations'").get();
    expect(hookTable).toBeUndefined();

    db.close();
  });

  it('migration 003 creates supervisor tables and composite integrity indexes', async () => {
    const { runMigrations } = await import('./db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((item) => item.name)).toEqual(
      expect.arrayContaining(['supervisors', 'supervisor_cycles'])
    );

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    expect(indexes.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'idx_sessions_id_workspace',
        'idx_supervisors_workspace',
        'idx_supervisors_session',
        'idx_supervisors_id_session',
        'idx_supervisor_cycles_supervisor',
        'idx_supervisor_cycles_session',
      ])
    );

    db.close();
  });

  it('migration 007 creates the auth login blocks table and index', async () => {
    const { runMigrations } = await import('./db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_login_blocks'").get() as
      | { name: string }
      | undefined;
    expect(table?.name).toBe('auth_login_blocks');

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    expect(indexes.map((item) => item.name)).toContain('idx_auth_login_blocks_blocked_until');

    db.close();
  });

  it('migration 008 creates the auth login failures table and index', async () => {
    const { runMigrations } = await import('./db');
    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_login_failures'").get() as
      | { name: string }
      | undefined;
    expect(table?.name).toBe('auth_login_failures');

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    expect(indexes.map((item) => item.name)).toContain('idx_auth_login_failures_ip_failed_at');

    db.close();
  });

  it('migration 008 backfills existing auth login block counts into failure rows', async () => {
    const { runMigrations } = await import('./db');

    const db = new DatabaseSync(dbPath);
    const migrationsDir = join(import.meta.dirname, 'migrations');

    for (const file of [
      '001_init.sql',
      '002_transcript_path.sql',
      '003_supervisors.sql',
      '004_session_title.sql',
      '005_auth_sessions.sql',
      '006_drop_legacy_hook_session_columns.sql',
      '007_auth_login_blocks.sql',
    ]) {
      db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      );
    `);

    for (const [index, name] of [
      '001_init',
      '002_transcript_path',
      '003_supervisors',
      '004_session_title',
      '005_auth_sessions',
      '006_drop_legacy_hook_session_columns',
      '007_auth_login_blocks',
    ].entries()) {
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(index + 1, name, 1000 + index);
    }

    db.prepare(`
      INSERT INTO auth_login_blocks (ip, failed_count, first_failed_at, last_failed_at, blocked_until)
      VALUES (?, ?, ?, ?, ?)
    `).run('198.51.100.24', 9, 1000, 2000, null);

    runMigrations(db);

    const failures = db.prepare(`
      SELECT failed_at
      FROM auth_login_failures
      WHERE ip = ?
      ORDER BY failed_at ASC
    `).all('198.51.100.24') as Array<{ failed_at: number }>;

    expect(failures).toHaveLength(9);
    expect(failures[0]?.failed_at).toBe(1000);
    expect(failures[failures.length - 1]?.failed_at).toBe(2000);

    db.close();
  });
});
