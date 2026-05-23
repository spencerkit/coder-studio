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

  it("sanitizes pm2 and runtime override env before invoking install and restart commands", async () => {
    const env = createEnv();
    const runCommand = vi.fn(async () => {});
    const originalEnv = {
      PM2_HOME: process.env.PM2_HOME,
      PM2_PROGRAMMATIC: process.env.PM2_PROGRAMMATIC,
      PM2_JSON_PROCESSING: process.env.PM2_JSON_PROCESSING,
      PM2_INTERACTOR_PROCESSING: process.env.PM2_INTERACTOR_PROCESSING,
      NODE_APP_INSTANCE: process.env.NODE_APP_INSTANCE,
      NODE_CHANNEL_FD: process.env.NODE_CHANNEL_FD,
      NODE_CHANNEL_SERIALIZATION_MODE: process.env.NODE_CHANNEL_SERIALIZATION_MODE,
      CODER_STUDIO_RUNTIME_JSON_PATH: process.env.CODER_STUDIO_RUNTIME_JSON_PATH,
      CODER_STUDIO_SESSION_ID: process.env.CODER_STUDIO_SESSION_ID,
      CODER_STUDIO_UPDATE_STATE_PATH: process.env.CODER_STUDIO_UPDATE_STATE_PATH,
      pm_id: process.env.pm_id,
    };

    process.env.PM2_HOME = "/tmp/custom-pm2-home";
    process.env.PM2_PROGRAMMATIC = "true";
    process.env.PM2_JSON_PROCESSING = "true";
    process.env.PM2_INTERACTOR_PROCESSING = "true";
    process.env.NODE_APP_INSTANCE = "0";
    process.env.NODE_CHANNEL_FD = "3";
    process.env.NODE_CHANNEL_SERIALIZATION_MODE = "json";
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = "/tmp/runtime.json";
    process.env.CODER_STUDIO_SESSION_ID = "sess_test";
    process.env.CODER_STUDIO_UPDATE_STATE_PATH = "/tmp/update-state.json";
    process.env.pm_id = "0";

    try {
      await runUpdateWorker(env, {
        runCommand,
        now: () => 1000,
      });
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }

    for (const call of runCommand.mock.calls) {
      const options = call[2] as { env?: NodeJS.ProcessEnv };
      expect(options.env?.PM2_HOME).toBe("/tmp/custom-pm2-home");
      expect(options.env?.PM2_PROGRAMMATIC).toBeUndefined();
      expect(options.env?.PM2_JSON_PROCESSING).toBeUndefined();
      expect(options.env?.PM2_INTERACTOR_PROCESSING).toBeUndefined();
      expect(options.env?.NODE_APP_INSTANCE).toBeUndefined();
      expect(options.env?.NODE_CHANNEL_FD).toBeUndefined();
      expect(options.env?.NODE_CHANNEL_SERIALIZATION_MODE).toBeUndefined();
      expect(options.env?.CODER_STUDIO_RUNTIME_JSON_PATH).toBeUndefined();
      expect(options.env?.CODER_STUDIO_SESSION_ID).toBeUndefined();
      expect(options.env?.CODER_STUDIO_UPDATE_STATE_PATH).toBeUndefined();
      expect(options.env?.pm_id).toBeUndefined();
    }
  });
});
