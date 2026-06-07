import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "../server.js";

describe("server built-in skills wiring", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let server: Server | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }

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

    vi.resetModules();
  });

  it("syncs built-in skills and wires automation audit log on startup", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "coder-studio-server-builtin-skills-"));
    process.env.HOME = join(tempDir, "home");
    process.env.USERPROFILE = join(tempDir, "home");
    vi.resetModules();

    const { createServer } = await import("../server.js");
    server = await createServer({
      stateDir: join(tempDir, "state-root"),
      host: "127.0.0.1",
      port: 0,
    });

    const ctx = server.__test__!.commandContext;

    expect(ctx.builtinSkillSyncMgr).toBeDefined();
    expect(ctx.automationAuditLog).toBeDefined();
    expect(ctx.stateRoot).toBe(join(tempDir, "state-root"));
    expect(ctx.skillLibraryRepo?.get("coder-studio-automation")).toMatchObject({
      source: "builtin",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const skillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-automation",
      "SKILL.md"
    );
    expect(existsSync(skillPath)).toBe(true);
    await expect(readFile(skillPath, "utf8")).resolves.toContain("coder-studio identify --json");
  }, 20_000);
});
