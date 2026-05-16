import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTerminalBrokerRuntime,
  readTerminalBrokerRuntime,
  writeTerminalBrokerRuntime,
} from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, ping, status } = vi.hoisted(() => ({
  spawn: vi.fn(),
  ping: vi.fn(),
  status: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn,
}));

vi.mock("@coder-studio/server", () => ({
  TerminalBrokerClient: class MockTerminalBrokerClient {
    ping = ping;
    status = status;
  },
}));

import { ensureTerminalBroker } from "./terminal-broker-control.js";

describe("terminal-broker-control", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-terminal-broker-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    process.env.CODER_STUDIO_RUNTIME_DIR = join(testHomeDir, ".coder-studio");
    deleteTerminalBrokerRuntime();
    ping.mockResolvedValue(true);
    status.mockResolvedValue({
      pid: 9001,
      startedAt: 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    deleteTerminalBrokerRuntime();

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

    rmSync(testHomeDir, { recursive: true, force: true });
  });

  it("starts the broker entry script when no runtime file exists", async () => {
    spawn.mockImplementation(
      (
        _command: string,
        _args: string[],
        options: { env?: Record<string, string>; detached?: boolean; stdio?: string }
      ) => {
        writeTerminalBrokerRuntime({
          endpoint: options.env?.CODER_STUDIO_TERMINAL_BROKER_ENDPOINT ?? "/tmp/broker.sock",
          pid: 5150,
          startedAt: 1000,
        });

        return {
          pid: 5150,
          unref: vi.fn(),
        };
      }
    );

    const runtime = await ensureTerminalBroker({
      script: "/cli/dist/esm/terminal-broker-runner.mjs",
      cwd: "/repo",
      waitMs: 200,
    });

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        expect.stringContaining('["/cli/dist/esm/terminal-broker-runner.mjs"]'),
      ],
      expect.objectContaining({
        cwd: "/repo",
        detached: true,
        stdio: "ignore",
      })
    );
    expect(runtime.endpoint).toBeTruthy();
    expect(readTerminalBrokerRuntime()).toEqual(runtime);
  });

  it("logs stale broker runtime details when ping fails and restart trace is enabled", async () => {
    vi.stubEnv("CODER_STUDIO_RESTART_TRACE", "1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    writeTerminalBrokerRuntime({
      endpoint: join(testHomeDir, ".coder-studio", "terminal-broker.sock"),
      pid: process.pid,
      startedAt: 1234,
    });

    ping
      .mockRejectedValueOnce(
        Object.assign(new Error("connect ENOENT broker.sock"), { code: "ENOENT" })
      )
      .mockResolvedValueOnce(true);

    spawn.mockImplementation(
      (
        _command: string,
        _args: string[],
        options: { env?: Record<string, string>; detached?: boolean; stdio?: string }
      ) => {
        writeTerminalBrokerRuntime({
          endpoint: options.env?.CODER_STUDIO_TERMINAL_BROKER_ENDPOINT ?? "/tmp/broker.sock",
          pid: 5151,
          startedAt: 5678,
        });

        return {
          pid: 5151,
          unref: vi.fn(),
        };
      }
    );

    await ensureTerminalBroker({
      script: "/cli/dist/esm/terminal-broker-runner.mjs",
      cwd: "/repo",
      waitMs: 200,
    });

    expect(warnSpy).toHaveBeenCalledWith("[restart-trace] terminal_broker.runtime_stale", {
      endpoint: join(testHomeDir, ".coder-studio", "terminal-broker.sock"),
      pid: process.pid,
      startedAt: 1234,
      socketExists: false,
      processAlive: true,
      message: "connect ENOENT broker.sock",
    });
  });

  it("reuses a live broker when the runtime file is missing", async () => {
    mkdirSync(join(testHomeDir, ".coder-studio"), { recursive: true });
    writeFileSync(join(testHomeDir, ".coder-studio", "terminal-broker.sock"), "", "utf8");
    spawn.mockImplementation(() => ({
      pid: 5152,
      unref: vi.fn(),
    }));

    const runtime = await ensureTerminalBroker({
      script: "/cli/dist/esm/terminal-broker-runner.mjs",
      cwd: "/repo",
      waitMs: 50,
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(runtime).toEqual({
      endpoint: join(testHomeDir, ".coder-studio", "terminal-broker.sock"),
      pid: 9001,
      startedAt: 1000,
    });
    expect(readTerminalBrokerRuntime()).toEqual(runtime);
  });
});
