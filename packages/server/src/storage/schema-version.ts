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

export type SchemaState = "empty" | "current" | "v1" | "incompatible";

export interface SchemaDetection {
  state: SchemaState;
  userVersion: number;
  mismatch: string | null;
}

export const CURRENT_SCHEMA_VERSION = 2;

const CURRENT_SCHEMA_PATH = join(import.meta.dirname, "migrations", "001_init.sql");

export const CURRENT_SCHEMA_SQL = readFileSync(CURRENT_SCHEMA_PATH, "utf-8");

export const V1_SCHEMA_SQL = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  target_runtime TEXT NOT NULL,
  wsl_distro TEXT,
  opened_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ui_state TEXT
);

CREATE TABLE terminals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  cwd TEXT NOT NULL,
  argv TEXT NOT NULL,
  env TEXT,
  title TEXT,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER
);

CREATE INDEX idx_terminals_workspace ON terminals(workspace_id);
CREATE INDEX idx_terminals_kind ON terminals(workspace_id, kind);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_active_at INTEGER NOT NULL,
  completion_percent INTEGER,
  error_reason TEXT,
  archived BOOLEAN DEFAULT 0,
  title TEXT
);

CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE UNIQUE INDEX idx_sessions_terminal ON sessions(terminal_id);
CREATE UNIQUE INDEX idx_sessions_id_workspace ON sessions(id, workspace_id);

CREATE TABLE provider_configs (
  provider_id TEXT PRIMARY KEY,
  config TEXT NOT NULL
);

CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_sessions_last_seen_at ON auth_sessions(last_seen_at);

CREATE TABLE supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id, workspace_id) REFERENCES sessions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_supervisors_workspace ON supervisors(workspace_id);
CREATE INDEX idx_supervisors_session ON supervisors(session_id);
CREATE UNIQUE INDEX idx_supervisors_id_session ON supervisors(id, session_id);

CREATE TABLE supervisor_cycles (
  id TEXT PRIMARY KEY,
  supervisor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  turn_id TEXT,
  progress INTEGER,
  result TEXT,
  injected_guidance TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (supervisor_id, session_id) REFERENCES supervisors(id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_supervisor_cycles_supervisor ON supervisor_cycles(supervisor_id, created_at DESC);
CREATE INDEX idx_supervisor_cycles_session ON supervisor_cycles(session_id, created_at DESC);

CREATE TABLE auth_login_blocks (
  ip TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX idx_auth_login_blocks_blocked_until ON auth_login_blocks(blocked_until);

CREATE TABLE auth_login_failures (
  ip TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_login_failures_ip_failed_at ON auth_login_failures(ip, failed_at);
`;

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
const V1_SCHEMA_ENTRIES = buildSchemaEntries(V1_SCHEMA_SQL);

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
  const actualEntries = listSchemaEntries(db);
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

  if (hasExactFingerprint(actualEntries, V1_SCHEMA_ENTRIES)) {
    return {
      state: "v1",
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
