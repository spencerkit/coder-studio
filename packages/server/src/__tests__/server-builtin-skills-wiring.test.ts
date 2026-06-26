import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "../server.js";
import {
  AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
  AUTOMATION_CMD_FILE_NAME,
} from "../skills/builtin/automation-bridge.js";

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
    expect(server.__test__?.hostContext.runtimeRouter).toBeDefined();
    expect(server.__test__?.nativeRuntime).toBeDefined();

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
        expect.objectContaining({
          slug: "coder-studio-canvas",
          source: "builtin",
          installState: "installed",
          builtin: { defaultEnabled: true, autoMount: true },
        }),
      ])
    );
    expect(ctx.skillLibraryRepo?.list().filter((entry) => entry.source === "builtin")).toHaveLength(
      3
    );
    expect(ctx.skillLibraryRepo?.getCustomSkillRoot()).toBe(
      join(tempDir, "state-root", "state", "skills", "custom")
    );

    const builtinRoot = join(tempDir, "state-root", "state", "skills", "builtin");
    const builtinOpenSkillPath = join(builtinRoot, "coder-studio-open", "SKILL.md");
    expect(existsSync(builtinOpenSkillPath)).toBe(true);
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("ui.open-file");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("ui.open-url");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("ui.close-file");
    expect(readFileSync(builtinOpenSkillPath, "utf8")).toContain("ui.close-url");
    expect(existsSync(join(builtinRoot, "coder-studio-open", AUTOMATION_CMD_FILE_NAME))).toBe(true);

    const builtinMemorySkillPath = join(builtinRoot, "coder-studio-memory", "SKILL.md");
    expect(existsSync(builtinMemorySkillPath)).toBe(true);
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("memory.list");
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("memory.search");
    expect(readFileSync(builtinMemorySkillPath, "utf8")).toContain("memory.create");
    expect(readFileSync(builtinMemorySkillPath, "utf8")).not.toContain("memory add");
    expect(existsSync(join(builtinRoot, "coder-studio-memory", AUTOMATION_CMD_FILE_NAME))).toBe(
      true
    );

    const builtinCanvasSkillPath = join(builtinRoot, "coder-studio-canvas", "SKILL.md");
    expect(existsSync(builtinCanvasSkillPath)).toBe(true);
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain("canvas.create");
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain("canvas.update");
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain("canvas.render");
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain(
      "ui.open-file --path .coder-studio/canvases/<title-slug>.csc"
    );
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain(
      "canvas.render --source-path .coder-studio/canvases/<title-slug>.csc"
    );
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain(
      "ui.open-canvas --canvas <canvas-id>"
    );
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).toContain(
      "readable `.coder-studio/canvases/<title-slug>.csc` paths"
    );
    expect(readFileSync(builtinCanvasSkillPath, "utf8")).not.toContain(
      ".coder-studio/canvases/<canvas-id>.canvas.json"
    );
    expect(existsSync(join(builtinRoot, "coder-studio-canvas", AUTOMATION_CMD_FILE_NAME))).toBe(
      true
    );

    const homeOpenSkillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-open",
      "SKILL.md"
    );
    expect(existsSync(homeOpenSkillPath)).toBe(true);
    expect(readFileSync(homeOpenSkillPath, "utf8")).not.toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain(
      join(tempDir, "home", ".agents", "skills", "coder-studio-open", AUTOMATION_CMD_FILE_NAME)
    );
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("ui.open-file");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("ui.open-url");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("ui.close-file");
    expect(readFileSync(homeOpenSkillPath, "utf8")).toContain("ui.close-url");
    expect(
      existsSync(
        join(tempDir, "home", ".agents", "skills", "coder-studio-open", AUTOMATION_CMD_FILE_NAME)
      )
    ).toBe(true);

    const homeMemorySkillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-memory",
      "SKILL.md"
    );
    expect(existsSync(homeMemorySkillPath)).toBe(true);
    expect(readFileSync(homeMemorySkillPath, "utf8")).not.toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain(
      join(tempDir, "home", ".agents", "skills", "coder-studio-memory", AUTOMATION_CMD_FILE_NAME)
    );
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("memory.list");
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("memory.search");
    expect(readFileSync(homeMemorySkillPath, "utf8")).toContain("memory.create");
    expect(readFileSync(homeMemorySkillPath, "utf8")).not.toContain("memory add");
    expect(
      existsSync(
        join(tempDir, "home", ".agents", "skills", "coder-studio-memory", AUTOMATION_CMD_FILE_NAME)
      )
    ).toBe(true);

    const homeCanvasSkillPath = join(
      tempDir,
      "home",
      ".agents",
      "skills",
      "coder-studio-canvas",
      "SKILL.md"
    );
    expect(existsSync(homeCanvasSkillPath)).toBe(true);
    expect(readFileSync(homeCanvasSkillPath, "utf8")).not.toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain(
      join(tempDir, "home", ".agents", "skills", "coder-studio-canvas", AUTOMATION_CMD_FILE_NAME)
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain("canvas.create");
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain("canvas.update");
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain("canvas.render");
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain(
      "ui.open-file --path .coder-studio/canvases/<title-slug>.csc"
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain(
      "canvas.render --source-path .coder-studio/canvases/<title-slug>.csc"
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain(
      "ui.open-canvas --canvas <canvas-id>"
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).toContain(
      "readable `.coder-studio/canvases/<title-slug>.csc` paths"
    );
    expect(readFileSync(homeCanvasSkillPath, "utf8")).not.toContain(
      ".coder-studio/canvases/<canvas-id>.canvas.json"
    );
    expect(
      existsSync(
        join(tempDir, "home", ".agents", "skills", "coder-studio-canvas", AUTOMATION_CMD_FILE_NAME)
      )
    ).toBe(true);
  }, 30_000);
});
