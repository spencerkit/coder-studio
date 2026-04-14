import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Opens a SQLite database with WAL mode and foreign key constraints enabled.
 * Runs an integrity check on startup.
 * 
 * @param dbPath - Path to the SQLite database file
 * @returns Database instance
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and crash recovery
  db.pragma('journal_mode = WAL');

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');

  // Run integrity check
  const integrityResult = db.pragma('integrity_check');
  if (integrityResult[0].integrity_check !== 'ok') {
    throw new Error(`Database integrity check failed: ${JSON.stringify(integrityResult)}`);
  }

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Runs database migrations.
 * In Phase 1, we only have a single migration file.
 *
 * @param db - Database instance
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);
  
  // Read and apply the initial migration
  const migrationPath = join(import.meta.dirname, 'migrations', '001_init.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');
  
  // Check if migration has already been applied
  const applied = db.prepare('SELECT id FROM _migrations WHERE name = ?').get('001_init');
  
  if (!applied) {
    // Apply migration in a transaction
    const transaction = db.transaction(() => {
      db.exec(migrationSQL);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run('001_init', Date.now());
    });
    
    transaction();
  }
}

/**
 * Closes the database connection gracefully.
 * 
 * @param db - Database instance
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
}
