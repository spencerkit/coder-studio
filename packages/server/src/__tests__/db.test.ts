import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "../storage/index.js";
import { CURRENT_SCHEMA_VERSION, IncompatibleSchemaError } from "../storage/schema-version.js";

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

    it("should stamp user_version on fresh empty database initialization", () => {
      const dbPath = join(tempDir, "fresh.db");
      db = openDatabase(dbPath);

      const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(userVersion.user_version).toBe(CURRENT_SCHEMA_VERSION);
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
          "terminals",
          "user_settings",
          "workspaces",
        ])
      );
      expect(tables.map((table) => table.name)).not.toContain("_migrations");
      expect(tables.map((table) => table.name)).not.toContain("supervisors");
      expect(tables.map((table) => table.name)).not.toContain("supervisor_cycles");
      expect(tables.map((table) => table.name)).not.toContain("supervisor_cycle_attempts");
    });

    it("should restamp user_version for an already-current schema when it is unset", () => {
      const dbPath = join(tempDir, "current-unstamped.db");
      db = openDatabase(dbPath);
      closeDatabase(db);

      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec("PRAGMA user_version = 0");
      rawDb.close();

      db = openDatabase(dbPath);

      const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(userVersion.user_version).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("should throw a typed incompatible-schema error for unknown schemas", () => {
      const dbPath = join(tempDir, "incompatible.db");
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec("CREATE TABLE unexpected_table (id TEXT PRIMARY KEY)");
      rawDb.close();

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
          "auth_login_blocks",
          "auth_login_failures",
        ])
      );
      expect(tableNames).not.toContain("supervisors");
      expect(tableNames).not.toContain("supervisor_cycles");
      expect(tableNames).not.toContain("supervisor_cycle_attempts");
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
          "idx_auth_login_blocks_blocked_until",
          "idx_auth_login_failures_ip_failed_at",
        ])
      );
      expect(indexNames).not.toContain("idx_supervisors_workspace");
      expect(indexNames).not.toContain("idx_supervisors_session");
      expect(indexNames).not.toContain("idx_supervisors_id_session");
      expect(indexNames).not.toContain("idx_supervisor_cycles_supervisor");
      expect(indexNames).not.toContain("idx_supervisor_cycles_session");
      expect(indexNames).not.toContain("idx_supervisor_cycle_attempts_cycle");
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
