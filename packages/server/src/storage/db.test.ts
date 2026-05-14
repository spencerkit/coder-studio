import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("database schema baseline", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "coder-studio-test-"));
    dbPath = join(dbDir, "test.db");
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("creates the current schema baseline without migration bookkeeping", async () => {
    const { openDatabase, closeDatabase } = await import("./db");
    const { CURRENT_SCHEMA_VERSION } = await import("./schema-version");

    const db = openDatabase(dbPath);

    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);

    expect(tableNames).toEqual(
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
    expect(tableNames).not.toContain("_migrations");
    expect(tableNames).not.toContain("hook_registrations");

    const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    expect(sessionColumns.find((column) => column.name === "resume_id")).toBeUndefined();
    expect(sessionColumns.find((column) => column.name === "transcript_path")).toBeUndefined();
    expect(sessionColumns.find((column) => column.name === "title")).toBeDefined();

    const supervisorColumns = db.prepare("PRAGMA table_info(supervisors)").all() as Array<{
      name: string;
    }>;
    expect(supervisorColumns.find((column) => column.name === "target_id")).toBeDefined();

    const indexNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        "idx_auth_login_blocks_blocked_until",
        "idx_auth_login_failures_ip_failed_at",
        "idx_auth_sessions_last_seen_at",
        "idx_sessions_id_workspace",
        "idx_sessions_terminal",
        "idx_sessions_workspace",
        "idx_supervisor_cycles_session",
        "idx_supervisor_cycles_supervisor",
        "idx_supervisors_id_session",
        "idx_supervisors_session",
        "idx_supervisors_workspace",
        "idx_terminals_kind",
        "idx_terminals_workspace",
      ])
    );

    const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(userVersion.user_version).toBe(CURRENT_SCHEMA_VERSION);

    closeDatabase(db);
  });

  it("restamps the current schema when user_version is reset to zero", async () => {
    const { openDatabase, closeDatabase } = await import("./db");
    const { CURRENT_SCHEMA_VERSION } = await import("./schema-version");

    const db = openDatabase(dbPath);
    closeDatabase(db);

    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec("PRAGMA user_version = 0");
    rawDb.close();

    const reopened = openDatabase(dbPath);
    const userVersion = reopened.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(userVersion.user_version).toBe(CURRENT_SCHEMA_VERSION);
    closeDatabase(reopened);
  });

  it("rejects a legacy database schema that still contains resume_id with a typed incompatible-schema error", async () => {
    const { openDatabase } = await import("./db");
    const { IncompatibleSchemaError } = await import("./schema-version");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        resume_id TEXT,
        capability TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_active_at INTEGER NOT NULL,
        completion_percent INTEGER,
        error_reason TEXT,
        archived BOOLEAN DEFAULT 0
      );
    `);
    db.close();

    let thrown: unknown;
    try {
      openDatabase(dbPath);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompatibleSchemaError);
    expect(thrown).toMatchObject({ code: "db_incompatible_schema" });
    expect((thrown as Error).message).toContain("db_incompatible_schema");
  });

  it("rejects a legacy database schema that still contains hook_registrations with a typed incompatible-schema error", async () => {
    const { openDatabase } = await import("./db");
    const { IncompatibleSchemaError } = await import("./schema-version");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE hook_registrations (
        provider_id TEXT PRIMARY KEY,
        marker_version TEXT NOT NULL
      );
    `);
    db.close();

    let thrown: unknown;
    try {
      openDatabase(dbPath);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompatibleSchemaError);
    expect(thrown).toMatchObject({ code: "db_incompatible_schema" });
    expect((thrown as Error).message).toContain("db_incompatible_schema");
  });

  it("rejects a legacy database schema that still contains transcript_path with a typed incompatible-schema error", async () => {
    const { openDatabase } = await import("./db");
    const { IncompatibleSchemaError } = await import("./schema-version");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_active_at INTEGER NOT NULL,
        completion_percent INTEGER,
        error_reason TEXT,
        archived BOOLEAN DEFAULT 0,
        transcript_path TEXT
      );
    `);
    db.close();

    let thrown: unknown;
    try {
      openDatabase(dbPath);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompatibleSchemaError);
    expect(thrown).toMatchObject({ code: "db_incompatible_schema" });
    expect((thrown as Error).message).toContain("db_incompatible_schema");
  });

  it("rejects a legacy database schema that still contains _migrations with a typed incompatible-schema error", async () => {
    const { openDatabase } = await import("./db");
    const { IncompatibleSchemaError } = await import("./schema-version");

    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      );
    `);
    db.close();

    let thrown: unknown;
    try {
      openDatabase(dbPath);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompatibleSchemaError);
    expect(thrown).toMatchObject({ code: "db_incompatible_schema" });
    expect((thrown as Error).message).toContain("db_incompatible_schema");
  });

  it("rejects a non-empty database whose schema does not match the current baseline", async () => {
    const { openDatabase } = await import("./db");

    const db = new DatabaseSync(dbPath);
    db.exec(`
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
        archived BOOLEAN DEFAULT 0
      );

      CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
      CREATE UNIQUE INDEX idx_sessions_terminal ON sessions(terminal_id);
    `);
    db.close();

    expect(() => openDatabase(dbPath)).toThrow(/Database schema mismatch detected/);
  });

  it("rejects a database that only contains a user-defined view", async () => {
    const { openDatabase } = await import("./db");

    const db = new DatabaseSync(dbPath);
    db.exec("CREATE VIEW orphan_view AS SELECT 1 AS value;");
    db.close();

    expect(() => openDatabase(dbPath)).toThrow(/Database schema mismatch detected/);
  });

  it("rejects a database with an extra user-defined trigger", async () => {
    const { openDatabase, closeDatabase } = await import("./db");

    const db = openDatabase(dbPath);
    db.exec(`
      CREATE TRIGGER sessions_after_insert
      AFTER INSERT ON sessions
      BEGIN
        UPDATE sessions SET title = NEW.title WHERE id = NEW.id;
      END;
    `);
    closeDatabase(db);

    expect(() => openDatabase(dbPath)).toThrow(/Database schema mismatch detected/);
  });

  it("runMigrations rejects the same partial schema drift as openDatabase", async () => {
    const { runMigrations } = await import("./db");

    const db = new DatabaseSync(":memory:");
    db.exec(`
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
        archived BOOLEAN DEFAULT 0
      );
    `);

    expect(() => runMigrations(db)).toThrow(/Database schema mismatch detected/);
    db.close();
  });

  it("closes the database handle when openDatabase fails schema validation", async () => {
    const sqlite = await import("node:sqlite");
    const dbModule = await import("./db");
    const closeSpy = vi.spyOn(sqlite.DatabaseSync.prototype, "close");

    const seed = new sqlite.DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_active_at INTEGER NOT NULL,
        completion_percent INTEGER,
        error_reason TEXT,
        archived BOOLEAN DEFAULT 0
      );
    `);
    seed.close();
    closeSpy.mockClear();

    expect(() => dbModule.openDatabase(dbPath)).toThrow(/Database schema mismatch detected/);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    closeSpy.mockRestore();
  });
});
