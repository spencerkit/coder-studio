import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTerminalBrokerRuntime,
  readTerminalBrokerRuntime,
  writeTerminalBrokerRuntime,
} from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, ping } = vi.hoisted(() => ({
  spawn: vi.fn(),
  ping: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn,
}));

vi.mock("@coder-studio/server", () => ({
  TerminalBrokerClient: class MockTerminalBrokerClient {
    ping = ping;
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
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
      ["/cli/dist/esm/terminal-broker-runner.mjs"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      })
    );
    expect(runtime.endpoint).toBeTruthy();
    expect(readTerminalBrokerRuntime()).toEqual(runtime);
  });
});
