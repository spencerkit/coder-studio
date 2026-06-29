import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeConfig } from "@coder-studio/core/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveEmbeddedRuntimePaths,
  startDesktopSidecar,
  waitForHealthyRuntime,
} from "./sidecar-manager.js";

type SpawnDep = NonNullable<Parameters<typeof startDesktopSidecar>[1]>["spawn"];

describe("sidecar-manager", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

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
      runtimeEntry:
        "/Applications/Coder Studio.app/Contents/Resources/runtime/seed/dist/esm/runtime-launch-entry.mjs",
      runtimeVersion: undefined,
      webRoot: "/Applications/Coder Studio.app/Contents/Resources/runtime/seed/dist/web",
      runtimeJsonPath: "/Users/test/Library/Application Support/Coder Studio/runtime/runtime.json",
    });
  });

  it("prefers the active runtime pointer from runtime-store when present", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "coder-studio-sidecar-runtime-store-"));
    tempDirs.push(userDataDir);
    const versionDir = join(userDataDir, "runtime-store", "versions", "0.5.4");
    await mkdir(join(versionDir, "dist", "esm"), { recursive: true });
    await writeFile(
      join(userDataDir, "runtime-store", "current.json"),
      JSON.stringify(
        {
          version: "0.5.4",
          installedAt: 1700000000000,
          path: versionDir,
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
          checksumSha256: "sha-123",
          source: "github-release",
        },
        null,
        2
      )
    );

    expect(
      resolveEmbeddedRuntimePaths({
        isPackaged: true,
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
        appPath: "/Applications/Coder Studio.app/Contents/Resources/app.asar",
        userDataDir,
        platform: "darwin",
      })
    ).toEqual({
      nodeExecutable: "/Applications/Coder Studio.app/Contents/Resources/runtime/node/node",
      runtimeEntry: join(versionDir, "dist", "esm", "runtime-launch-entry.mjs"),
      runtimeVersion: "0.5.4",
      webRoot: join(versionDir, "dist", "web"),
      runtimeJsonPath: join(userDataDir, "runtime", "runtime.json"),
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

  it("retries transient health check failures until the runtime becomes healthy", async () => {
    const healthyRuntime: RuntimeConfig = {
      host: "localhost",
      port: 4173,
      pid: 91234,
      token: "server-91234",
      serverInstanceId: "server-91234",
      startedAt: 1700000000000,
    };
    let attempts = 0;

    const result = await waitForHealthyRuntime({
      readRuntimeConfig: () => healthyRuntime,
      checkUrl: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("ECONNREFUSED");
        }
      },
      sleep: async () => {},
      timeoutMs: 1_000,
      startedAt: 0,
      expectedPid: 91234,
      now: () => attempts * 100,
    });

    expect(attempts).toBe(3);
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
      send: ReturnType<typeof vi.fn>;
    };
    child.pid = 1001;
    child.kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.send = vi.fn(() => true);

    const spawn = vi.fn(() => child) as unknown as SpawnDep;

    await startDesktopSidecar(
      {
        paths: {
          nodeExecutable: "/bundle/runtime/node/node",
          runtimeEntry: "/bundle/runtime/cli/dist/esm/runtime-launch-entry.mjs",
          runtimeVersion: "0.5.4",
          webRoot: "/bundle/runtime/cli/dist/web",
          runtimeJsonPath: "/tmp/runtime.json",
        },
        stateDir: "/tmp/coder-studio-state",
        hostOverride: "0.0.0.0",
        portOverride: 43123,
        password: "sekrit",
        appVersion: "1.2.3",
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
      ["/bundle/runtime/cli/dist/esm/runtime-launch-entry.mjs"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
        env: expect.objectContaining({
          CODER_STUDIO_DESKTOP_HOST: "0.0.0.0",
          CODER_STUDIO_DESKTOP_PORT: "43123",
          CODER_STUDIO_DESKTOP_STATE_DIR: "/tmp/coder-studio-state",
          CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
          CODER_STUDIO_DESKTOP_APP_VERSION: "1.2.3",
          CODER_STUDIO_DESKTOP_PASSWORD: "sekrit",
          CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "0.5.4",
          CODER_STUDIO_DESKTOP_WEB_ROOT: "/bundle/runtime/cli/dist/web",
        }),
      })
    );
  });

  it("re-emits child IPC messages on the started sidecar handle", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      stdout: EventEmitter;
      stderr: EventEmitter;
      send: ReturnType<typeof vi.fn>;
    };
    child.pid = 1003;
    child.kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.send = vi.fn(() => true);

    const spawn = vi.fn(() => child) as unknown as SpawnDep;
    const handle = await startDesktopSidecar(
      {
        paths: {
          nodeExecutable: "/bundle/runtime/node/node",
          runtimeEntry: "/bundle/runtime/cli/dist/esm/runtime-launch-entry.mjs",
          runtimeVersion: "0.5.4",
          webRoot: "/bundle/runtime/cli/dist/web",
          runtimeJsonPath: "/tmp/runtime.json",
        },
        stateDir: "/tmp/coder-studio-state",
      },
      {
        spawn,
        waitForHealthyRuntime: async () => ({
          browserUrl: "http://127.0.0.1:43123",
          runtime: {
            host: "127.0.0.1",
            port: 43123,
            pid: 1003,
            token: "server-1003",
            serverInstanceId: "server-1003",
            startedAt: 1,
          },
        }),
      }
    );

    const listener = vi.fn();
    handle.on("message", listener);

    child.emit("message", {
      kind: "desktop-update",
      action: "start-install",
      payload: {
        targetVersion: "0.5.5",
      },
    });

    expect(listener).toHaveBeenCalledWith({
      kind: "desktop-update",
      action: "start-install",
      payload: {
        targetVersion: "0.5.5",
      },
    });
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
    child.kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true);
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    const spawn = vi.fn(() => child) as unknown as SpawnDep;

    const startup = startDesktopSidecar(
      {
        paths: {
          nodeExecutable: "/bundle/runtime/node/node",
          runtimeEntry: "/bundle/runtime/cli/dist/esm/runtime-launch-entry.mjs",
          runtimeVersion: "0.5.4",
          webRoot: "/bundle/runtime/cli/dist/web",
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
