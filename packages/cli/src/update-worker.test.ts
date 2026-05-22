import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runUpdateWorker } from "./update-worker.js";

describe("update-worker", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createEnv() {
    const dir = mkdtempSync(join(tmpdir(), "update-worker-"));
    tempDirs.push(dir);
    return {
      stateFilePath: join(dir, "update-state.json"),
      logFilePath: join(dir, "update-worker.log"),
      packageName: "@spencer-kit/coder-studio",
      targetVersion: "0.5.0",
      cliCommand: "coder-studio",
      currentVersion: "0.4.0",
      npmCommand: "npm",
      restartArgs: ["serve", "--restart"],
      installArgsPrefix: ["install", "-g"],
    };
  }

  it("writes restarting state after install success and restart handoff", async () => {
    const env = createEnv();
    const runCommand = vi.fn(async () => {});

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
    });

    const state = JSON.parse(readFileSync(env.stateFilePath, "utf-8")) as { updateStatus: string };
    expect(state.updateStatus).toBe("restarting");
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "-g", "@spencer-kit/coder-studio@0.5.0"],
      expect.any(Object)
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "coder-studio",
      ["serve", "--restart"],
      expect.any(Object)
    );
  });

  it("falls back to manual_required on permission-related install errors", async () => {
    const env = createEnv();
    const runCommand = vi.fn(async () => {
      throw new Error("npm install failed with EACCES");
    });

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
    });

    const state = JSON.parse(readFileSync(env.stateFilePath, "utf-8")) as {
      updateStatus: string;
      manualCommand: string;
      requiresManualStep: boolean;
    };
    expect(state.updateStatus).toBe("manual_required");
    expect(state.requiresManualStep).toBe(true);
    expect(state.manualCommand).toContain("npm install -g @spencer-kit/coder-studio@0.5.0");
  });

  it("marks restart failures with manual restart guidance", async () => {
    const env = createEnv();
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("pm2 restart failed"));

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
    });

    const state = JSON.parse(readFileSync(env.stateFilePath, "utf-8")) as {
      updateStatus: string;
      manualCommand: string;
      errorSummary: string;
    };
    expect(state.updateStatus).toBe("failed");
    expect(state.manualCommand).toBe("coder-studio serve --restart");
    expect(state.errorSummary).toContain("restart failed");
  });
});
