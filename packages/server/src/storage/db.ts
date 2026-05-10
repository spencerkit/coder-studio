import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { type Database, withTransaction } from "./database.js";

interface IntegrityCheckRow {
  integrity_check: string;
}

interface TableNameRow {
  name: string;
}

interface ColumnInfoRow {
  name: string;
}

interface SchemaEntryRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface SchemaEntry {
  type: string;
  name: string;
  tableName: string;
  sql: string;
}

const SCHEMA_PATH = join(import.meta.dirname, "migrations", "001_init.sql");
const SCHEMA_SQL = readFileSync(SCHEMA_PATH, "utf-8");

const LEGACY_TABLES = ["hook_registrations", "_migrations"] as const;
const LEGACY_SESSION_COLUMNS = ["resume_id"] as const;

function normalizeSql(sql: string | null): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

function listSchemaEntries(db: Database): SchemaEntry[] {
  const rows = db
    .prepare(
      `
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE type IN ('table', 'index', 'view', 'trigger')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `
    )
    .all() as unknown as SchemaEntryRow[];

  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    tableName: row.tbl_name,
    sql: normalizeSql(row.sql),
  }));
}

function buildExpectedSchemaEntries(): SchemaEntry[] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SCHEMA_SQL);
    return listSchemaEntries(db);
  } finally {
    db.close();
  }
}

const EXPECTED_SCHEMA_ENTRIES = buildExpectedSchemaEntries();

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

function schemaEntrySignature(entry: SchemaEntry): string {
  return `${entry.type}:${entry.name}:${entry.tableName}:${entry.sql}`;
}

function isSchemaEmpty(db: Database): boolean {
  return listSchemaEntries(db).length === 0;
}

function assertNoLegacySchema(db: Database, dbPath: string): void {
  const reasons = detectLegacySchema(db);
  if (reasons.length === 0) {
    return;
  }

  throw new Error(
    `Legacy database schema detected at ${dbPath}: ${reasons.join(", ")}. ` +
      "This build no longer supports automatic database upgrades. Delete the local database file and restart."
  );
}

function describeSchemaMismatch(expected: SchemaEntry[], actual: SchemaEntry[]): string {
  const expectedByName = new Map(expected.map((entry) => [`${entry.type}:${entry.name}`, entry]));
  const actualByName = new Map(actual.map((entry) => [`${entry.type}:${entry.name}`, entry]));
  const keys = new Set([...expectedByName.keys(), ...actualByName.keys()]);

  for (const key of keys) {
    const expectedEntry = expectedByName.get(key);
    const actualEntry = actualByName.get(key);

    if (!expectedEntry) {
      return `unexpected ${actualEntry?.type ?? "schema object"} ${actualEntry?.name ?? key}`;
    }

    if (!actualEntry) {
      return `missing ${expectedEntry.type} ${expectedEntry.name}`;
    }

    if (schemaEntrySignature(expectedEntry) !== schemaEntrySignature(actualEntry)) {
      return `definition mismatch for ${expectedEntry.type} ${expectedEntry.name}`;
    }
  }

  return "unknown schema drift";
}

function assertSchemaMatchesBaseline(db: Database, dbPath: string): void {
  const actualEntries = listSchemaEntries(db);
  const expectedSignatures = EXPECTED_SCHEMA_ENTRIES.map(schemaEntrySignature);
  const actualSignatures = actualEntries.map(schemaEntrySignature);

  if (
    actualSignatures.length === expectedSignatures.length &&
    actualSignatures.every((signature, index) => signature === expectedSignatures[index])
  ) {
    return;
  }

  const mismatch = describeSchemaMismatch(EXPECTED_SCHEMA_ENTRIES, actualEntries);
  throw new Error(
    `Database schema mismatch detected at ${dbPath}: ${mismatch}. ` +
      "This build requires the current baseline schema. Delete the local database file and restart."
  );
}

function initializeSchema(db: Database): void {
  withTransaction(db, () => {
    db.exec(SCHEMA_SQL);
  });
}

function initializeOrValidateSchema(db: Database, dbPath: string): void {
  assertNoLegacySchema(db, dbPath);

  if (isSchemaEmpty(db)) {
    initializeSchema(db);
    assertSchemaMatchesBaseline(db, dbPath);
    return;
  }

  assertSchemaMatchesBaseline(db, dbPath);
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

    initializeOrValidateSchema(db, dbPath);

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
  initializeOrValidateSchema(db, ":memory:");
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
