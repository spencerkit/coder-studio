import * as runtimeModule from "@coder-studio/core/runtime";
import { writeRuntimeConfig } from "@coder-studio/core/runtime";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, start, deleteProcess, describeProcess, disconnect } = vi.hoisted(() => ({
  connect: vi.fn(),
  start: vi.fn(),
  deleteProcess: vi.fn(),
  describeProcess: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("pm2", () => ({
  default: {
    connect,
    start,
    delete: deleteProcess,
    describe: describeProcess,
    disconnect,
  },
}));

import {
  deleteManagedServer,
  getLogPaths,
  getManagedServerStatus,
  MANAGED_SERVER_NAME,
  startManagedServer,
} from "./pm2-control";

describe("pm2-control", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
  const originalRuntimeJsonPath = process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-pm2-control-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    process.env.CODER_STUDIO_RUNTIME_DIR = join(testHomeDir, ".coder-studio");
    delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;

    connect.mockImplementation((callback: (error: Error | null) => void) => callback(null));
    disconnect.mockImplementation((callback?: (error: Error | null) => void) => {
      callback?.(null);
      return undefined;
    });
    start.mockImplementation(
      (
        _script: string,
        _config: unknown,
        callback: (error: Error | null, apps: unknown[]) => void
      ) => {
        writeRuntimeConfig({
          host: "127.0.0.1",
          port: 4187,
          pid: 424242,
          token: "test-token",
          serverInstanceId: "server-1",
          startedAt: Date.now(),
        });
        callback(null, [{ pm_id: 1 }]);
      }
    );
    deleteProcess.mockImplementation((_name: string, callback: (error: Error | null) => void) =>
      callback(null)
    );
    describeProcess.mockImplementation(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [])
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

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

    if (originalRuntimeDir === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_DIR;
    } else {
      process.env.CODER_STUDIO_RUNTIME_DIR = originalRuntimeDir;
    }

    if (originalRuntimeJsonPath === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
    } else {
      process.env.CODER_STUDIO_RUNTIME_JSON_PATH = originalRuntimeJsonPath;
    }

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }
  });

  it("starts the managed server with the fixed app name", async () => {
    process.env.NODE_ENV = "development";

    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    expect(start).toHaveBeenCalledWith(
      "/cli/dist/esm/server-runner.js",
      expect.objectContaining({
        name: MANAGED_SERVER_NAME,
        cwd: "/repo",
        autorestart: true,
        restart_delay: 2000,
        min_uptime: "5s",
        max_restarts: 10,
        out_file: join(testHomeDir, ".coder-studio", "logs", "server.out.log"),
        error_file: join(testHomeDir, ".coder-studio", "logs", "server.err.log"),
      }),
      expect.any(Function)
    );
  });

  it("temporarily forces NODE_ENV=production during PM2 startup without passing env opts", async () => {
    process.env.NODE_ENV = "development";

    start.mockImplementationOnce(
      (
        _script: string,
        config: unknown,
        callback: (error: Error | null, apps: unknown[]) => void
      ) => {
        expect(process.env.NODE_ENV).toBe("production");
        expect(config).not.toHaveProperty("env");
        writeRuntimeConfig({
          host: "127.0.0.1",
          port: 4187,
          pid: 424242,
          token: "test-token",
          serverInstanceId: "server-1",
          startedAt: Date.now(),
        });
        callback(null, [{ pm_id: 1 }]);
      }
    );

    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    expect(process.env.NODE_ENV).toBe("development");
  });

  it("starts PM2 in script mode instead of JSON config mode", async () => {
    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    expect(start).toHaveBeenCalledWith(
      "/cli/dist/esm/server-runner.js",
      expect.not.objectContaining({
        script: expect.anything(),
      }),
      expect.any(Function)
    );
  });

  it("passes script args through for the managed server entrypoint", async () => {
    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
      args: ["--flag"],
    });

    expect(start).toHaveBeenCalledWith(
      "/cli/dist/esm/server-runner.js",
      expect.objectContaining({
        args: ["--flag"],
      }),
      expect.any(Function)
    );
  });

  it("writes a restart intent before deleting the running server when restart=true", async () => {
    const writeRestartIntentSpy = vi.spyOn(runtimeModule, "writeRestartIntent");

    writeRuntimeConfig({
      host: "127.0.0.1",
      port: 4187,
      pid: 424242,
      token: "test-token",
      serverInstanceId: "server-1",
      startedAt: Date.now(),
    });

    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
      restart: true,
    });

    expect(writeRestartIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedServerInstanceId: "server-1",
        mode: "preserve_terminals",
      })
    );
  });

  it("deletes the restart intent after a successful managed restart", async () => {
    const deleteRestartIntentSpy = vi.spyOn(runtimeModule, "deleteRestartIntent");

    writeRuntimeConfig({
      host: "127.0.0.1",
      port: 4187,
      pid: 424242,
      token: "test-token",
      serverInstanceId: "server-1",
      startedAt: Date.now(),
    });

    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
      restart: true,
    });

    expect(deleteRestartIntentSpy).toHaveBeenCalled();
  });

  it("waits for the previous PM2 app to disappear before starting a replacement", async () => {
    describeProcess
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "online", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "stopping", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [])
      );

    const pendingStart = startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    await expect(
      Promise.race([
        pendingStart.then(() => "started"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 20)),
      ])
    ).resolves.toBe("waiting");

    expect(start).not.toHaveBeenCalled();
    await pendingStart;
  });

  it("reuses one pm2 session while polling deletion during startup", async () => {
    describeProcess
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "online", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "stopping", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [])
      );

    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting during startup when delete reports missing but the old app still lingers", async () => {
    describeProcess
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "online", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 111, pm2_env: { status: "stopping", restart_time: 0 } }])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [])
      );
    deleteProcess.mockImplementationOnce((_name: string, callback: (error: Error | null) => void) =>
      callback(new Error("process or namespace not found"))
    );

    const pendingStart = startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    await expect(
      Promise.race([
        pendingStart.then(() => "started"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 20)),
      ])
    ).resolves.toBe("waiting");

    expect(start).not.toHaveBeenCalled();
    await pendingStart;
  });

  it("ignores delete-time missing errors when requested", async () => {
    describeProcess.mockImplementationOnce(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [{ pid: 424242, pm2_env: { status: "online", restart_time: 0 } }])
    );
    deleteProcess.mockImplementationOnce((_name: string, callback: (error: Error | null) => void) =>
      callback(new Error("process or namespace not found"))
    );

    await expect(deleteManagedServer({ ignoreMissing: true })).resolves.toBe(false);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails background startup when runtime readiness times out", async () => {
    start.mockImplementationOnce(
      (
        _script: string,
        _config: unknown,
        callback: (error: Error | null, apps: unknown[]) => void
      ) => {
        callback(null, [{ pm_id: 1 }]);
      }
    );
    describeProcess
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [])
      )
      .mockImplementationOnce(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [])
      )
      .mockImplementation(
        (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
          callback(null, [{ pid: 424242, pm2_env: { status: "online", restart_time: 0 } }])
      );

    await expect(
      startManagedServer({
        script: "/cli/dist/esm/server-runner.js",
        cwd: "/repo",
        waitMs: 1,
      })
    ).rejects.toThrow(
      "Run `coder-studio logs` for details or `coder-studio serve --foreground` for interactive debugging."
    );
  });

  it("includes only the current startup error log excerpt when background startup fails", async () => {
    const { errFile } = getLogPaths();
    mkdirSync(dirname(errFile), { recursive: true });
    writeFileSync(errFile, "Error: stale previous startup failure\n");

    start.mockImplementationOnce(
      (
        _script: string,
        config: unknown,
        callback: (error: Error | null, apps: unknown[]) => void
      ) => {
        const errorFile = (config as { error_file: string }).error_file;
        writeFileSync(
          errorFile,
          "Error: listen EADDRINUSE: address already in use 127.0.0.1:4187\n",
          { flag: "a" }
        );
        callback(null, [{ pm_id: 1 }]);
      }
    );
    describeProcess.mockImplementationOnce(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [{ pid: 424242, pm2_env: { status: "errored", restart_time: 1 } }])
    );

    let startupError: unknown;
    try {
      await startManagedServer({
        script: "/cli/dist/esm/server-runner.js",
        cwd: "/repo",
        waitMs: 10,
      });
    } catch (error) {
      startupError = error;
    }

    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toContain(
      "Error: listen EADDRINUSE: address already in use 127.0.0.1:4187"
    );
    expect((startupError as Error).message).not.toContain("Error: stale previous startup failure");
  });

  it("maps missing PM2 app to stopped status", async () => {
    describeProcess.mockImplementationOnce(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [])
    );

    await expect(getManagedServerStatus()).resolves.toEqual({
      status: "stopped",
      pm2Pid: null,
      restartCount: 0,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("maps an online PM2 app to running status", async () => {
    describeProcess.mockImplementationOnce(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [{ pid: 424242, pm2_env: { status: "online", restart_time: 2 } }])
    );

    await expect(getManagedServerStatus()).resolves.toEqual({
      status: "running",
      pm2Pid: 424242,
      restartCount: 2,
    });
  });

  it("maps a stopped PM2 app to stopped status", async () => {
    describeProcess.mockImplementationOnce(
      (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
        callback(null, [{ pid: 424242, pm2_env: { status: "stopped", restart_time: 2 } }])
    );

    await expect(getManagedServerStatus()).resolves.toEqual({
      status: "stopped",
      pm2Pid: null,
      restartCount: 2,
    });
  });

  it("returns fixed log paths under the coder-studio home directory", () => {
    expect(getLogPaths()).toEqual({
      outFile: join(testHomeDir, ".coder-studio", "logs", "server.out.log"),
      errFile: join(testHomeDir, ".coder-studio", "logs", "server.err.log"),
    });
  });
});
