import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import { withTransaction, type Database } from './database.js';

const MIGRATION_PATTERN = /^\d{3}_.+\.sql$/;

interface IntegrityCheckRow {
  integrity_check: string;
}

interface MigrationNameRow {
  name: string;
}

/**
 * Opens a SQLite database with WAL mode and foreign key constraints enabled.
 * Runs an integrity check on startup.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns Database instance
 */
export function openDatabase(dbPath: string): Database {
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for better concurrency and crash recovery
  db.exec('PRAGMA journal_mode = WAL');

  // Enable foreign key constraints
  db.exec('PRAGMA foreign_keys = ON');

  // Run integrity check
  const integrityResult = db.prepare('PRAGMA integrity_check').all() as unknown as IntegrityCheckRow[];
  if (integrityResult[0]?.integrity_check !== 'ok') {
    throw new Error(`Database integrity check failed: ${JSON.stringify(integrityResult)}`);
  }

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Discovers all migration files matching the pattern in the migrations directory.
 *
 * @returns Array of migration file names sorted alphabetically (which ensures numerical order)
 */
function discoverMigrations(): string[] {
  const migrationsDir = join(import.meta.dirname, 'migrations');
  const files = readdirSync(migrationsDir);
  return files
    .filter(file => MIGRATION_PATTERN.test(file))
    .sort();
}

/**
 * Runs database migrations.
 * Dynamically discovers all SQL files matching /^\d{3}_.+\.sql$/ in the migrations directory
 * and applies them in alphabetical order.
 *
 * @param db - Database instance
 */
export function runMigrations(db: Database): void {
  // Create migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);

  // Discover all migration files
  const migrationFiles = discoverMigrations();

  // Get already applied migrations
  const appliedMigrationRows = db.prepare('SELECT name FROM _migrations').all() as unknown as MigrationNameRow[];
  const appliedMigrations = new Set(appliedMigrationRows.map((row) => row.name));

  // Apply each migration that hasn't been applied yet
  const migrationsDir = join(import.meta.dirname, 'migrations');
  for (const migrationFile of migrationFiles) {
    // Extract migration name from filename (e.g., "001_init" from "001_init.sql")
    const migrationName = migrationFile.replace(/\.sql$/, '');

    if (appliedMigrations.has(migrationName)) {
      continue;
    }

    const migrationPath = join(migrationsDir, migrationFile);
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Apply migration in a transaction
    withTransaction(db, () => {
      db.exec(migrationSQL);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(migrationName, Date.now());
    });
  }
}

/**
 * Closes the database connection gracefully.
 * 
 * @param db - Database instance
 */
export function closeDatabase(db: Database): void {
  if (db.isOpen) {
    db.close();
  }
}
