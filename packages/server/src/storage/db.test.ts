import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'fs';
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

  it('migration 002 adds transcript_path column to sessions', async () => {
    const { runMigrations } = await import('./db');

    const db = new DatabaseSync(dbPath);
    runMigrations(db);

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const transcriptCol = cols.find(c => c.name === 'transcript_path');
    expect(transcriptCol).toBeDefined();

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
});
