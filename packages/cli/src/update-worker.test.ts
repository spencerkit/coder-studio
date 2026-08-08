import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRestartHandoff, runUpdateCommand, runUpdateWorker } from "./update-worker.js";

type UpdateWorkerDeps = NonNullable<Parameters<typeof runUpdateWorker>[1]>;
type RestartHandoffDeps = NonNullable<Parameters<typeof runRestartHandoff>[1]>;
type RunCommandMock = NonNullable<UpdateWorkerDeps["runCommand"]>;
type SpawnDetachedProcessMock = NonNullable<UpdateWorkerDeps["spawnDetachedProcess"]>;
type WaitForProcessExitMock = NonNullable<RestartHandoffDeps["waitForProcessExit"]>;

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
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      targetPublishedAt: "2026-08-08T00:00:00.000Z",
      npmCommand: "npm",
      restartArgs: ["serve", "--restart"],
      installArgsPrefix: ["install", "-g"],
    };
  }

  it("includes child stderr in command failures so permission fallback is deterministic", async () => {
    await expect(
      runUpdateCommand(
        process.execPath,
        ["-e", "console.error('permission scenario EACCES'); process.exit(17)"],
        { env: process.env }
      )
    ).rejects.toThrow("permission scenario EACCES");
  });

  it("writes restarting state and spawns a detached restart handoff after install success", async () => {
    const env = createEnv();
    const runCommand = vi.fn<RunCommandMock>(async () => {});
    const spawnDetachedProcess = vi.fn<SpawnDetachedProcessMock>(async () => {});

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
      processId: 4242,
      spawnDetachedProcess,
    });

    const state = JSON.parse(readFileSync(env.stateFilePath, "utf-8")) as { updateStatus: string };
    expect(state.updateStatus).toBe("restarting");
    expect(state).toMatchObject({
      version: 2,
      currentPublishedAt: env.currentPublishedAt,
      latestPublishedAt: env.targetPublishedAt,
    });
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "-g", "@spencer-kit/coder-studio@0.5.0"],
      expect.any(Object)
    );
    expect(spawnDetachedProcess).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        CODER_STUDIO_UPDATE_WORKER_MODE: "restart-handoff",
        CODER_STUDIO_UPDATE_PARENT_PID: "4242",
      })
    );
  });

  it("falls back to manual_required on permission-related install errors", async () => {
    const env = createEnv();
    const runCommand = vi.fn<RunCommandMock>(async () => {
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
    expect(state).toMatchObject({
      version: 2,
      currentPublishedAt: env.currentPublishedAt,
      latestPublishedAt: env.targetPublishedAt,
    });
  });

  it("marks ordinary install errors as failed without unsafe manual fallback", async () => {
    const env = createEnv();
    const runCommand = vi.fn<RunCommandMock>(async () => {
      throw new Error("registry checksum mismatch");
    });

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
    });

    expect(JSON.parse(readFileSync(env.stateFilePath, "utf-8"))).toMatchObject({
      version: 2,
      updateStatus: "failed",
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: "registry checksum mismatch",
      currentPublishedAt: env.currentPublishedAt,
      latestPublishedAt: env.targetPublishedAt,
    });
  });

  it("reports a manual restart command when restart handoff cannot be spawned", async () => {
    const env = createEnv();
    const runCommand = vi.fn<RunCommandMock>(async () => {});
    const spawnDetachedProcess = vi.fn<SpawnDetachedProcessMock>(async () => {
      throw new Error("spawn denied");
    });

    await runUpdateWorker(env, {
      runCommand,
      now: () => 1000,
      processId: 4242,
      spawnDetachedProcess,
    });

    expect(JSON.parse(readFileSync(env.stateFilePath, "utf-8"))).toMatchObject({
      version: 2,
      updateStatus: "failed",
      requiresManualStep: true,
      manualCommand: "coder-studio serve --restart",
      errorSummary: "new version installed but service restart failed: spawn denied",
      currentPublishedAt: env.currentPublishedAt,
      latestPublishedAt: env.targetPublishedAt,
    });
  });

  it("marks restart failures with manual restart guidance", async () => {
    const env = createEnv();
    const runCommand = vi
      .fn<RunCommandMock>()
      .mockRejectedValueOnce(new Error("pm2 restart failed"));
    const waitForProcessExit = vi.fn<WaitForProcessExitMock>(async () => {});

    await runRestartHandoff(env, {
      runCommand,
      now: () => 1000,
      waitForProcessExit,
      restartParentPid: 999,
    });

    const state = JSON.parse(readFileSync(env.stateFilePath, "utf-8")) as {
      updateStatus: string;
      manualCommand: string;
      errorSummary: string;
    };
    expect(state.updateStatus).toBe("failed");
    expect(state.manualCommand).toBe("coder-studio serve --restart");
    expect(state.errorSummary).toContain("restart failed");
    expect(state).toMatchObject({
      version: 2,
      currentPublishedAt: env.currentPublishedAt,
      latestPublishedAt: env.targetPublishedAt,
    });
    expect(waitForProcessExit).toHaveBeenCalledWith(999);
  });

  it("sanitizes pm2 and runtime override env before invoking install and restart commands", async () => {
    const env = createEnv();
    const runCommand = vi.fn<RunCommandMock>(async () => {});
    const spawnDetachedProcess = vi.fn<SpawnDetachedProcessMock>(async () => {});
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
        processId: 4242,
        spawnDetachedProcess,
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

    for (const [, , options] of runCommand.mock.calls) {
      expect(options).toBeDefined();
      if (!options) {
        throw new Error("Expected runCommand to receive an options object");
      }

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

    const handoffCall = spawnDetachedProcess.mock.calls[0];
    const handoffEnv = handoffCall?.[2];
    expect(handoffEnv?.PM2_HOME).toBe("/tmp/custom-pm2-home");
    expect(handoffEnv?.PM2_PROGRAMMATIC).toBeUndefined();
    expect(handoffEnv?.PM2_JSON_PROCESSING).toBeUndefined();
    expect(handoffEnv?.PM2_INTERACTOR_PROCESSING).toBeUndefined();
    expect(handoffEnv?.NODE_APP_INSTANCE).toBeUndefined();
    expect(handoffEnv?.NODE_CHANNEL_FD).toBeUndefined();
    expect(handoffEnv?.NODE_CHANNEL_SERIALIZATION_MODE).toBeUndefined();
    expect(handoffEnv?.CODER_STUDIO_RUNTIME_JSON_PATH).toBeUndefined();
    expect(handoffEnv?.CODER_STUDIO_SESSION_ID).toBeUndefined();
    expect(handoffEnv?.pm_id).toBeUndefined();
  });

  it("waits for the install worker to exit before running the restart command", async () => {
    const env = createEnv();
    const waitForProcessExit = vi.fn<WaitForProcessExitMock>(async () => {});
    const runCommand = vi.fn<RunCommandMock>(async () => {});

    await runRestartHandoff(env, {
      runCommand,
      now: () => 1000,
      waitForProcessExit,
      restartParentPid: 777,
    });

    expect(waitForProcessExit).toHaveBeenCalledWith(777);
    expect(runCommand).toHaveBeenCalledWith(
      "coder-studio",
      ["serve", "--restart"],
      expect.any(Object)
    );
  });
});
