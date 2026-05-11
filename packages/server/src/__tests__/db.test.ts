import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "../storage/index.js";

const V1_SCHEMA_SQL = `
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

describe("Database", () => {
  let db: DatabaseSync;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "db-test-"));
  });

  afterEach(() => {
    if (db?.isOpen) {
      closeDatabase(db);
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("openDatabase", () => {
    it("should open a database and enable WAL mode", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(result.journal_mode).toBe("wal");
    });

    it("should enable foreign key constraints", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const result = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
    });

    it("should run integrity check successfully", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const result = db.prepare("PRAGMA integrity_check").all() as Array<{
        integrity_check: string;
      }>;
      expect(result[0]?.integrity_check).toBe("ok");
    });

    it("should not create the migrations table", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .get();
      expect(result).toBeUndefined();
    });

    it("should keep the schema stable on subsequent opens", () => {
      const dbPath = join(tempDir, "test.db");

      db = openDatabase(dbPath);
      closeDatabase(db);

      db = openDatabase(dbPath);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "auth_login_blocks",
          "auth_login_failures",
          "auth_sessions",
          "provider_configs",
          "sessions",
          "supervisor_cycles",
          "supervisors",
          "terminals",
          "user_settings",
          "workspaces",
        ])
      );
      expect(tables.map((table) => table.name)).not.toContain("_migrations");
    });

    it("should upgrade a known v1 supervisor schema to v2 when user_version is unset", () => {
      const dbPath = join(tempDir, "v1.db");
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec("PRAGMA user_version = 0");
      rawDb.exec(V1_SCHEMA_SQL);
      rawDb.close();

      db = openDatabase(dbPath);

      const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(userVersion.user_version).toBe(2);

      const supervisorColumns = db.prepare("PRAGMA table_info(supervisors)").all() as Array<{
        name: string;
      }>;
      expect(supervisorColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "evaluator_model",
          "max_supervision_count",
          "completed_supervision_count",
          "scheduled_at",
          "stop_reason",
        ])
      );

      const upgradedTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_cycle_attempts'"
        )
        .get() as { name: string } | undefined;
      expect(upgradedTable?.name).toBe("supervisor_cycle_attempts");

      const upgradedIndex = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_supervisor_cycle_attempts_cycle'"
        )
        .get() as { name: string } | undefined;
      expect(upgradedIndex?.name).toBe("idx_supervisor_cycle_attempts_cycle");
    });

    it("should throw a typed incompatible-schema error for unknown schemas", () => {
      const dbPath = join(tempDir, "incompatible.db");
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec("CREATE TABLE unexpected_table (id TEXT PRIMARY KEY)");
      rawDb.close();

      expect(() => openDatabase(dbPath)).toThrowError(/db_incompatible_schema/);
    });

    it("should create all required tables", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((table) => table.name);

      expect(tableNames).toEqual(
        expect.arrayContaining([
          "workspaces",
          "terminals",
          "sessions",
          "provider_configs",
          "user_settings",
          "auth_sessions",
          "supervisors",
          "supervisor_cycles",
          "supervisor_cycle_attempts",
          "auth_login_blocks",
          "auth_login_failures",
        ])
      );
    });

    it("should create required indexes", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
        )
        .all() as { name: string }[];
      const indexNames = indexes.map((index) => index.name);

      expect(indexNames).toEqual(
        expect.arrayContaining([
          "idx_terminals_workspace",
          "idx_terminals_kind",
          "idx_sessions_workspace",
          "idx_sessions_terminal",
          "idx_sessions_id_workspace",
          "idx_auth_sessions_last_seen_at",
          "idx_supervisors_workspace",
          "idx_supervisors_session",
          "idx_supervisors_id_session",
          "idx_supervisor_cycles_supervisor",
          "idx_supervisor_cycles_session",
          "idx_supervisor_cycle_attempts_cycle",
          "idx_auth_login_blocks_blocked_until",
          "idx_auth_login_failures_ip_failed_at",
        ])
      );
    });

    it("should support foreign key constraints", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      db.prepare(
        "INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("ws-1", "/path", "native", Date.now(), Date.now(), "{}");

      expect(() => {
        db.prepare(
          "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run("t-1", "non-existent-workspace", "agent", "/path", "[]", 80, 24, Date.now());
      }).toThrow();
    });

    it("should cascade delete terminals when workspace is deleted", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);

      db.prepare(
        "INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("ws-1", "/path", "native", Date.now(), Date.now(), "{}");

      db.prepare(
        "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("t-1", "ws-1", "agent", "/path", "[]", 80, 24, Date.now());

      db.prepare("DELETE FROM workspaces WHERE id = ?").run("ws-1");

      const terminal = db.prepare("SELECT * FROM terminals WHERE id = ?").get("t-1");
      expect(terminal).toBeUndefined();
    });
  });

  describe("closeDatabase", () => {
    it("should close the database connection", () => {
      const dbPath = join(tempDir, "test.db");
      db = openDatabase(dbPath);
      closeDatabase(db);

      expect(() => {
        db.prepare("SELECT 1").get();
      }).toThrow();
    });
  });
});
