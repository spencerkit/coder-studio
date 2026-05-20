import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "../storage/db.js";
import { AuthSessionRepo } from "../storage/repositories/auth-session-repo.js";

describe("AuthSessionRepo", () => {
  let tempDir: string;
  let repo: AuthSessionRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auth-session-repo-test-"));
    repo = new AuthSessionRepo({
      filePath: join(tempDir, "auth-sessions.json"),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates and touches sessions in the file store", () => {
    const created = repo.create("token-1", 1000);

    expect(created).toEqual({
      token: "token-1",
      createdAt: 1000,
      lastSeenAt: 1000,
    });

    expect(repo.touch("token-1", 2000)).toBe(true);
    expect(repo.touch("missing", 2000)).toBe(false);
  });

  it("deletes sessions from the file store", () => {
    repo.create("token-1", 1000);

    repo.delete("token-1");

    expect(repo.touch("token-1", 2000)).toBe(false);
  });

  it("migrates existing auth sessions from the legacy database when the file is missing", () => {
    const db = openDatabase(join(tempDir, "legacy.db"));
    try {
      db.prepare(
        "INSERT INTO auth_sessions (token, created_at, last_seen_at) VALUES (?, ?, ?)"
      ).run("legacy-token", 111, 222);

      const migratedRepo = new AuthSessionRepo({
        filePath: join(tempDir, "migrated-auth-sessions.json"),
        legacyDb: db,
      });

      expect(migratedRepo.touch("legacy-token", 333)).toBe(true);
    } finally {
      closeDatabase(db);
    }
  });
});
