import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTerminalBrokerRuntime } from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@coder-studio/server", () => ({
  TerminalBrokerClient: class MockTerminalBrokerClient {
    async ping(): Promise<boolean> {
      return true;
    }
  },
}));

import { ensureTerminalBroker } from "./terminal-broker-control.js";

describe("terminal-broker-control process isolation", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;

  let testRootDir: string;
  let runtimeDir: string;
  let brokerScriptPath: string;
  let brokerInfoPath: string;
  let brokerPid: number | null;

  beforeEach(() => {
    testRootDir = mkdtempSync(join(tmpdir(), "cs-terminal-broker-process-"));
    runtimeDir = join(testRootDir, "runtime");
    brokerScriptPath = join(testRootDir, "fake-broker.mjs");
    brokerInfoPath = join(testRootDir, "broker-process.json");
    brokerPid = null;

    mkdirSync(runtimeDir, { recursive: true });
    process.env.HOME = testRootDir;
    process.env.USERPROFILE = testRootDir;
    process.env.CODER_STUDIO_RUNTIME_DIR = runtimeDir;
    deleteTerminalBrokerRuntime();

    writeFileSync(
      brokerScriptPath,
      `
        import { mkdirSync, writeFileSync } from "node:fs";
        import { join } from "node:path";

        const runtimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
        if (!runtimeDir) {
          throw new Error("Missing CODER_STUDIO_RUNTIME_DIR");
        }

        mkdirSync(runtimeDir, { recursive: true });
        writeFileSync(
          join(runtimeDir, "terminal-broker.json"),
          JSON.stringify(
            {
              endpoint: process.env.CODER_STUDIO_TERMINAL_BROKER_ENDPOINT,
              pid: process.pid,
              startedAt: Date.now(),
            },
            null,
            2
          )
        );
        writeFileSync(
          ${JSON.stringify(brokerInfoPath)},
          JSON.stringify({ pid: process.pid, ppid: process.ppid }, null, 2)
        );

        setInterval(() => undefined, 1_000);
      `,
      "utf8"
    );
  });

  afterEach(() => {
    if (brokerPid !== null) {
      try {
        process.kill(brokerPid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }

    vi.restoreAllMocks();
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

    rmSync(testRootDir, { recursive: true, force: true });
  });

  it("launches the broker outside the current process tree", async () => {
    const runtime = await ensureTerminalBroker({
      script: brokerScriptPath,
      cwd: testRootDir,
      waitMs: 1_000,
    });
    brokerPid = runtime.pid;

    const brokerInfo = JSON.parse(readFileSync(brokerInfoPath, "utf8")) as {
      pid: number;
      ppid: number;
    };

    expect(brokerInfo.pid).toBe(runtime.pid);
    expect(brokerInfo.ppid).not.toBe(process.pid);
  });
});
