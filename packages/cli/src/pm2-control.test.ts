import { writeRuntimeConfig } from "@coder-studio/core/runtime";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-pm2-control-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;

    connect.mockImplementation((callback: (error: Error | null) => void) => callback(null));
    disconnect.mockImplementation(() => undefined);
    start.mockImplementation(
      (_config: unknown, callback: (error: Error | null, apps: unknown[]) => void) => {
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

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }
  });

  it("starts the managed server with the fixed app name", async () => {
    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        name: MANAGED_SERVER_NAME,
        script: "/cli/dist/esm/server-runner.js",
        cwd: "/repo",
        env: expect.objectContaining({
          NODE_ENV: "production",
        }),
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

  it("passes script args through for the managed server entrypoint", async () => {
    await startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 10,
      args: ["--flag"],
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        script: "/cli/dist/esm/server-runner.js",
        args: ["--flag"],
      }),
      expect.any(Function)
    );
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
  });

  it("fails background startup when runtime readiness times out", async () => {
    start.mockImplementationOnce(
      (_config: unknown, callback: (error: Error | null, apps: unknown[]) => void) => {
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

  it("maps missing PM2 app to stopped status", async () => {
    await expect(getManagedServerStatus()).resolves.toEqual({
      status: "stopped",
      pm2Pid: null,
      restartCount: 0,
    });
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
