import { EventEmitter } from "node:events";
import type { RuntimeConfig } from "@coder-studio/core/runtime";
import { describe, expect, it, vi } from "vitest";
import {
  resolveEmbeddedRuntimePaths,
  startDesktopSidecar,
  waitForHealthyRuntime,
} from "./sidecar-manager.js";

describe("sidecar-manager", () => {
  it("resolves packaged runtime paths relative to the Electron resources directory", () => {
    expect(
      resolveEmbeddedRuntimePaths({
        isPackaged: true,
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
        appPath: "/Applications/Coder Studio.app/Contents/Resources/app.asar",
        userDataDir: "/Users/test/Library/Application Support/Coder Studio",
        platform: "darwin",
      })
    ).toEqual({
      nodeExecutable: "/Applications/Coder Studio.app/Contents/Resources/runtime/node/node",
      desktopServerEntry:
        "/Applications/Coder Studio.app/Contents/Resources/runtime/cli/dist/esm/desktop-server.mjs",
      runtimeJsonPath: "/Users/test/Library/Application Support/Coder Studio/runtime/runtime.json",
    });
  });

  it("ignores stale runtime metadata from a different pid", async () => {
    const staleRuntime: RuntimeConfig = {
      host: "localhost",
      port: 4173,
      pid: 7000,
      token: "server-7000",
      serverInstanceId: "server-7000",
      startedAt: 1,
    };
    const healthyRuntime: RuntimeConfig = {
      host: "0.0.0.0",
      port: 43123,
      pid: 91234,
      token: "server-91234",
      serverInstanceId: "server-91234",
      startedAt: 1700000000000,
    };
    let reads = 0;

    const result = await waitForHealthyRuntime({
      readRuntimeConfig: () => {
        reads += 1;
        return reads === 1 ? staleRuntime : reads < 3 ? null : healthyRuntime;
      },
      checkUrl: async (url) => {
        expect(url).toBe("http://127.0.0.1:43123");
      },
      sleep: async () => {},
      timeoutMs: 1_000,
      startedAt: 0,
      expectedPid: 91234,
      now: () => reads * 50,
    });

    expect(result.browserUrl).toBe("http://127.0.0.1:43123");
    expect(result.runtime).toEqual(healthyRuntime);
  });

  it("spawns the embedded node runtime with desktop-server and desktop env overrides", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = 1001;
    child.kill = vi.fn(() => true);
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    const spawn = vi.fn(() => child);

    await startDesktopSidecar(
      {
        paths: {
          nodeExecutable: "/bundle/runtime/node/node",
          desktopServerEntry: "/bundle/runtime/cli/dist/esm/desktop-server.mjs",
          runtimeJsonPath: "/tmp/runtime.json",
        },
        stateDir: "/tmp/coder-studio-state",
        hostOverride: "0.0.0.0",
        portOverride: 43123,
        password: "sekrit",
      },
      {
        spawn,
        waitForHealthyRuntime: async () => ({
          browserUrl: "http://127.0.0.1:43123",
          runtime: {
            host: "0.0.0.0",
            port: 43123,
            pid: 1001,
            token: "server-1001",
            serverInstanceId: "server-1001",
            startedAt: 1,
          },
        }),
      }
    );

    expect(spawn).toHaveBeenCalledWith(
      "/bundle/runtime/node/node",
      ["/bundle/runtime/cli/dist/esm/desktop-server.mjs"],
      expect.objectContaining({
        windowsHide: true,
        env: expect.objectContaining({
          CODER_STUDIO_DESKTOP_HOST: "0.0.0.0",
          CODER_STUDIO_DESKTOP_PORT: "43123",
          CODER_STUDIO_DESKTOP_STATE_DIR: "/tmp/coder-studio-state",
          CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
          CODER_STUDIO_DESKTOP_PASSWORD: "sekrit",
        }),
      })
    );
  });

  it("fails fast with logs when the sidecar exits before becoming healthy", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = 1002;
    child.kill = vi.fn(() => true);
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    const spawn = vi.fn(() => child);

    const startup = startDesktopSidecar(
      {
        paths: {
          nodeExecutable: "/bundle/runtime/node/node",
          desktopServerEntry: "/bundle/runtime/cli/dist/esm/desktop-server.mjs",
          runtimeJsonPath: "/tmp/runtime.json",
        },
        stateDir: "/tmp/coder-studio-state",
      },
      {
        spawn,
        waitForHealthyRuntime: () => new Promise<never>(() => {}),
      }
    );

    child.stderr.emit("data", Buffer.from("boom\n"));
    child.exitCode = 1;
    child.emit("exit", 1, null);

    await expect(startup).rejects.toMatchObject({
      message: expect.stringMatching(/exited before becoming healthy/i),
      logExcerpt: "stderr: boom",
    });
  });
});
