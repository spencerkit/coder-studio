import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("materializes and auto-mounts default built-in skills on startup", async () => {
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
    expect(ctx.skillLibraryRepo?.list().filter((entry) => entry.source === "builtin")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "coder-studio-open",
          source: "builtin",
          installState: "installed",
          builtin: { defaultEnabled: true, autoMount: true },
        }),
        expect.objectContaining({
          slug: "coder-studio-memory",
          source: "builtin",
          installState: "installed",
          builtin: { defaultEnabled: true, autoMount: true },
        }),
      ])
    );
    expect(ctx.skillLibraryRepo?.list().filter((entry) => entry.source === "builtin")).toHaveLength(
      2
    );

    const builtinRoot = join(tempDir, "state-root", "state", "skills", "builtin");
    const builtinOpenSkillPath = join(builtinRoot, "coder-studio-open", "SKILL.md");
    expect(existsSync(builtinOpenSkillPath)).toBe(true);
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("coder-studio ui open-file");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("coder-studio ui open-url");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("coder-studio ui close-file");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("coder-studio ui close-url");

    const builtinMemorySkillPath = join(builtinRoot, "coder-studio-memory", "SKILL.md");
    expect(existsSync(builtinMemorySkillPath)).toBe(true);
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("coder-studio memory list");
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("coder-studio memory search");
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("coder-studio memory add");

    const homeOpenSkillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-open",
      "SKILL.md"
    );
    expect(existsSync(homeOpenSkillPath)).toBe(true);
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("coder-studio ui open-file");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("coder-studio ui open-url");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("coder-studio ui close-file");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("coder-studio ui close-url");

    const homeMemorySkillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-memory",
      "SKILL.md"
    );
    expect(existsSync(homeMemorySkillPath)).toBe(true);
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("coder-studio memory list");
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("coder-studio memory search");
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("coder-studio memory add");
  }, 20_000);
});
