import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@coder-studio/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAuthBlockByIp, listAuthBlocks } from "./auth-control.js";

describe("auth-control", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;
  let dbPath: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-auth-control-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    dbPath = join(testHomeDir, "auth-control.db");
    mkdirSync(join(testHomeDir, ".coder-studio"), { recursive: true });
    writeFileSync(
      join(testHomeDir, ".coder-studio", "config.json"),
      JSON.stringify({ dataDir: dbPath }, null, 2),
      "utf-8"
    );
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    rmSync(testHomeDir, { recursive: true, force: true });
  });

  it("lists and clears active auth blocks from the configured sqlite database", async () => {
    const db = openDatabase(dbPath);
    try {
      db.prepare(`
        INSERT INTO auth_login_blocks (ip, failed_count, first_failed_at, last_failed_at, blocked_until)
        VALUES (?, ?, ?, ?, ?)
      `).run("198.51.100.24", 10, 1000, 2000, 3000);
      db.prepare(`
        INSERT INTO auth_login_failures (ip, failed_at)
        VALUES (?, ?), (?, ?)
      `).run("198.51.100.24", 1000, "198.51.100.24", 2000);
      db.prepare(`
        INSERT INTO auth_login_blocks (ip, failed_count, first_failed_at, last_failed_at, blocked_until)
        VALUES (?, ?, ?, ?, ?)
      `).run("203.0.113.19", 3, 1000, 2000, null);
    } finally {
      db.close();
    }

    await expect(listAuthBlocks(2500)).resolves.toEqual([
      {
        ip: "198.51.100.24",
        failedCount: 10,
        firstFailedAt: 1000,
        lastFailedAt: 2000,
        blockedUntil: 3000,
      },
    ]);

    await expect(clearAuthBlockByIp("198.51.100.24")).resolves.toBe(true);
    await expect(listAuthBlocks(2500)).resolves.toEqual([]);

    const verificationDb = openDatabase(dbPath);
    try {
      const failures = verificationDb
        .prepare("SELECT ip, failed_at FROM auth_login_failures WHERE ip = ?")
        .all("198.51.100.24");
      expect(failures).toEqual([]);
    } finally {
      verificationDb.close();
    }
  });
});
