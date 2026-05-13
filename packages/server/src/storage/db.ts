import { DatabaseSync } from "node:sqlite";
import { type Database, withTransaction } from "./database.js";
import {
  CURRENT_SCHEMA_SQL,
  CURRENT_SCHEMA_VERSION,
  detectSchema,
  IncompatibleSchemaError,
  stampCurrentSchemaVersion,
} from "./schema-version.js";

interface IntegrityCheckRow {
  integrity_check: string;
}

interface TableNameRow {
  name: string;
}

interface ColumnInfoRow {
  name: string;
}

const LEGACY_TABLES = ["hook_registrations", "_migrations"] as const;
const LEGACY_SESSION_COLUMNS = ["resume_id", "transcript_path"] as const;

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName) as TableNameRow | undefined;
  return row?.name === tableName;
}

function getSessionColumns(db: Database): Set<string> {
  if (!hasTable(db, "sessions")) {
    return new Set();
  }

  const rows = db.prepare("PRAGMA table_info(sessions)").all() as unknown as ColumnInfoRow[];
  return new Set(rows.map((row) => row.name));
}

function detectLegacySchema(db: Database): string[] {
  const reasons: string[] = [];

  for (const tableName of LEGACY_TABLES) {
    if (hasTable(db, tableName)) {
      reasons.push(`legacy table ${tableName}`);
    }
  }

  const sessionColumns = getSessionColumns(db);
  for (const columnName of LEGACY_SESSION_COLUMNS) {
    if (sessionColumns.has(columnName)) {
      reasons.push(`legacy sessions column ${columnName}`);
    }
  }

  return reasons;
}

function throwIfLegacySchema(db: Database, dbPath: string): void {
  const reasons = detectLegacySchema(db);
  if (reasons.length === 0) {
    return;
  }

  throw new IncompatibleSchemaError(dbPath, `legacy schema detected (${reasons.join(", ")})`);
}

function initializeSchema(db: Database): void {
  withTransaction(db, () => {
    db.exec(CURRENT_SCHEMA_SQL);
  });
}

function upgradeSchemaV1ToV2(db: Database): void {
  withTransaction(db, () => {
    db.exec("ALTER TABLE supervisors ADD COLUMN evaluator_model TEXT");
    db.exec("ALTER TABLE supervisors ADD COLUMN max_supervision_count INTEGER NOT NULL DEFAULT 0");
    db.exec(
      "ALTER TABLE supervisors ADD COLUMN completed_supervision_count INTEGER NOT NULL DEFAULT 0"
    );
    db.exec("ALTER TABLE supervisors ADD COLUMN scheduled_at INTEGER");
    db.exec("ALTER TABLE supervisors ADD COLUMN stop_reason TEXT");
    db.exec(`
      CREATE TABLE supervisor_cycle_attempts (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES supervisor_cycles(id) ON DELETE CASCADE,
        attempt_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        error_reason TEXT,
        provider_model TEXT
      )
    `);
    db.exec(
      "CREATE INDEX idx_supervisor_cycle_attempts_cycle ON supervisor_cycle_attempts(cycle_id, attempt_index)"
    );
    stampCurrentSchemaVersion(db);
  });
}

function assertCurrentSchema(db: Database, dbPath: string): void {
  const detection = detectSchema(db);
  if (detection.state !== "current") {
    throw new IncompatibleSchemaError(dbPath, detection.mismatch ?? "unknown schema drift");
  }
}

function initializeOrUpgradeSchema(db: Database, dbPath: string): void {
  throwIfLegacySchema(db, dbPath);

  const detection = detectSchema(db);

  switch (detection.state) {
    case "empty":
      initializeSchema(db);
      assertCurrentSchema(db, dbPath);
      return;

    case "current":
      if (detection.userVersion !== CURRENT_SCHEMA_VERSION) {
        stampCurrentSchemaVersion(db);
      }
      assertCurrentSchema(db, dbPath);
      return;

    case "v1":
      upgradeSchemaV1ToV2(db);
      assertCurrentSchema(db, dbPath);
      return;

    case "incompatible":
      throw new IncompatibleSchemaError(dbPath, detection.mismatch ?? "unknown schema drift");
  }
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

  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    const integrityResult = db
      .prepare("PRAGMA integrity_check")
      .all() as unknown as IntegrityCheckRow[];
    if (integrityResult[0]?.integrity_check !== "ok") {
      throw new Error(`Database integrity check failed: ${JSON.stringify(integrityResult)}`);
    }

    initializeOrUpgradeSchema(db, dbPath);

    return db;
  } catch (error) {
    try {
      if (db.isOpen) {
        db.close();
      }
    } catch {
      // Preserve the startup failure as the primary error.
    }

    throw error;
  }
}

/**
 * Retained as a compatibility entry point for tests that initialize :memory:
 * databases explicitly before wiring command handlers.
 */
export function runMigrations(db: Database): void {
  initializeOrUpgradeSchema(db, ":memory:");
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
