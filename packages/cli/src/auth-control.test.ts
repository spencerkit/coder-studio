import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAuthBlockByIp, listAuthBlocks } from "./auth-control.js";

describe("auth-control", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;
  let legacyStateFilePath: string;
  let authBlocksPath: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-auth-control-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    legacyStateFilePath = join(testHomeDir, "legacy-state.sqlite");
    authBlocksPath = join(testHomeDir, "state", "auth-login-blocks.json");
    mkdirSync(join(testHomeDir, ".coder-studio"), { recursive: true });
    writeFileSync(
      join(testHomeDir, ".coder-studio", "config.json"),
      JSON.stringify({ dataDir: legacyStateFilePath }, null, 2),
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

  it("lists and clears active auth blocks from the configured file-backed state", async () => {
    mkdirSync(join(testHomeDir, "state"), { recursive: true });
    writeFileSync(
      authBlocksPath,
      JSON.stringify(
        {
          version: 1,
          blocks: {
            "198.51.100.24": {
              ip: "198.51.100.24",
              failedCount: 10,
              firstFailedAt: 1000,
              lastFailedAt: 2000,
              blockedUntil: 3000,
            },
            "203.0.113.19": {
              ip: "203.0.113.19",
              failedCount: 3,
              firstFailedAt: 1000,
              lastFailedAt: 2000,
              blockedUntil: null,
            },
          },
          failures: {
            "198.51.100.24": [1000, 2000],
            "203.0.113.19": [1000, 2000],
          },
        },
        null,
        2
      ),
      "utf-8"
    );

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

    const stored = JSON.parse(readFileSync(authBlocksPath, "utf-8")) as {
      failures: Record<string, number[] | undefined>;
    };
    expect(stored.failures["198.51.100.24"]).toBeUndefined();
  });
});
