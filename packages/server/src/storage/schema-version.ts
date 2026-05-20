import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import type { Database } from "./database.js";

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

interface UserVersionRow {
  user_version: number;
}

export type SchemaState = "empty" | "current" | "incompatible";

export interface SchemaDetection {
  state: SchemaState;
  userVersion: number;
  mismatch: string | null;
}

export const CURRENT_SCHEMA_VERSION = 2;

const CURRENT_SCHEMA_PATH = join(import.meta.dirname, "migrations", "001_init.sql");

export const CURRENT_SCHEMA_SQL = readFileSync(CURRENT_SCHEMA_PATH, "utf-8");

const LEGACY_SUPERVISOR_OBJECT_NAMES = new Set([
  "supervisors",
  "supervisor_cycles",
  "supervisor_cycle_attempts",
  "idx_supervisors_workspace",
  "idx_supervisors_session",
  "idx_supervisors_id_session",
  "idx_supervisor_cycles_supervisor",
  "idx_supervisor_cycles_session",
  "idx_supervisor_cycle_attempts_cycle",
]);

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

function isIgnoredLegacySupervisorEntry(entry: SchemaEntry): boolean {
  return (
    LEGACY_SUPERVISOR_OBJECT_NAMES.has(entry.name) ||
    LEGACY_SUPERVISOR_OBJECT_NAMES.has(entry.tableName)
  );
}

function normalizeActualEntries(entries: SchemaEntry[]): SchemaEntry[] {
  return entries.filter((entry) => !isIgnoredLegacySupervisorEntry(entry));
}

function schemaEntrySignature(entry: SchemaEntry): string {
  return `${entry.type}:${entry.name}:${entry.tableName}:${entry.sql}`;
}

function buildSchemaEntries(schemaSql: string): SchemaEntry[] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schemaSql);
    return listSchemaEntries(db);
  } finally {
    db.close();
  }
}

const CURRENT_SCHEMA_ENTRIES = buildSchemaEntries(CURRENT_SCHEMA_SQL);

function hasExactFingerprint(
  actualEntries: SchemaEntry[],
  expectedEntries: SchemaEntry[]
): boolean {
  if (actualEntries.length !== expectedEntries.length) {
    return false;
  }

  return actualEntries.every(
    (entry, index) => schemaEntrySignature(entry) === schemaEntrySignature(expectedEntries[index]!)
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

export function detectSchema(db: Database): SchemaDetection {
  const actualEntries = normalizeActualEntries(listSchemaEntries(db));
  const userVersionRow = db.prepare("PRAGMA user_version").get() as UserVersionRow | undefined;
  const userVersion = userVersionRow?.user_version ?? 0;

  if (actualEntries.length === 0) {
    return {
      state: "empty",
      userVersion,
      mismatch: null,
    };
  }

  if (hasExactFingerprint(actualEntries, CURRENT_SCHEMA_ENTRIES)) {
    return {
      state: "current",
      userVersion,
      mismatch: null,
    };
  }

  return {
    state: "incompatible",
    userVersion,
    mismatch: describeSchemaMismatch(CURRENT_SCHEMA_ENTRIES, actualEntries),
  };
}

export function stampCurrentSchemaVersion(db: Database): void {
  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
}

export class IncompatibleSchemaError extends Error {
  readonly code = "db_incompatible_schema";

  constructor(dbPath: string, mismatch: string) {
    super(
      `db_incompatible_schema: Database schema mismatch detected at ${dbPath}: ${mismatch}. ` +
        "This build requires the current baseline schema. Delete the local database file and restart."
    );
    this.name = "IncompatibleSchemaError";
  }
}
