import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "../storage/db.js";
import { AuthLoginBlockRepo } from "../storage/repositories/auth-login-block-repo.js";

describe("AuthLoginBlockRepo", () => {
  let tempDir: string;
  let repo: AuthLoginBlockRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auth-login-block-repo-test-"));
    repo = new AuthLoginBlockRepo({
      filePath: join(tempDir, "auth-login-blocks.json"),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("tracks failures in the file store and blocks when the threshold is reached", () => {
    const one = repo.recordFailure("203.0.113.8", 100, 0, 3, 500);
    const two = repo.recordFailure("203.0.113.8", 200, 0, 3, 500);
    const three = repo.recordFailure("203.0.113.8", 300, 0, 3, 500);

    expect(one.blockedUntil).toBeNull();
    expect(two.failedCount).toBe(2);
    expect(three).toEqual({
      ip: "203.0.113.8",
      failedCount: 3,
      firstFailedAt: 100,
      lastFailedAt: 300,
      blockedUntil: 800,
    });
    expect(repo.get("203.0.113.8")).toEqual(three);
    expect(repo.listActiveBlocks(400)).toEqual([three]);
  });

  it("drops expired window failures before counting the next attempt", () => {
    repo.recordFailure("198.51.100.4", 100, 0, 10, 500);
    repo.recordFailure("198.51.100.4", 200, 0, 10, 500);

    const next = repo.recordFailure("198.51.100.4", 1300, 1000, 10, 500);

    expect(next).toEqual({
      ip: "198.51.100.4",
      failedCount: 1,
      firstFailedAt: 1300,
      lastFailedAt: 1300,
      blockedUntil: null,
    });
  });

  it("deletes both block and failure state", () => {
    repo.recordFailure("192.0.2.4", 100, 0, 1, 500);

    expect(repo.delete("192.0.2.4")).toBe(true);
    expect(repo.get("192.0.2.4")).toBeNull();
    expect(repo.listActiveBlocks(200)).toEqual([]);
    expect(repo.delete("192.0.2.4")).toBe(false);
  });

  it("does not import auth block state from the legacy database when the file is missing", () => {
    const db = openDatabase(join(tempDir, "legacy.db"));
    try {
      db.prepare(
        "INSERT INTO auth_login_blocks (ip, failed_count, first_failed_at, last_failed_at, blocked_until) VALUES (?, ?, ?, ?, ?)"
      ).run("203.0.113.1", 2, 100, 200, 500);
      db.prepare("INSERT INTO auth_login_failures (ip, failed_at) VALUES (?, ?)").run(
        "203.0.113.1",
        100
      );
      db.prepare("INSERT INTO auth_login_failures (ip, failed_at) VALUES (?, ?)").run(
        "203.0.113.1",
        200
      );

      const fileRepo = new AuthLoginBlockRepo({
        filePath: join(tempDir, "migrated-auth-login-blocks.json"),
      });

      expect(fileRepo.get("203.0.113.1")).toBeNull();

      const next = fileRepo.recordFailure("203.0.113.1", 300, 0, 3, 500);
      expect(next.failedCount).toBe(1);
      expect(next.blockedUntil).toBeNull();
    } finally {
      closeDatabase(db);
    }
  });
});
