import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  launchDesktopSmokeLocal,
  parseDesktopSmokeLocalArgs,
  prepareDesktopLocalSmokeUserData,
  runDesktopSmokeLocal,
  type SmokeScriptRunner,
} from "./desktop-smoke-local.js";

function createChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true) as unknown as ChildProcess["kill"];
  return child;
}

describe("desktop-smoke-local", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("seeds the isolated runtime-store from the embedded desktop runtime", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-desktop-smoke-"));
    tempDirs.push(repoRoot);

    const runtimeEmbeddedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "embedded");
    await mkdir(join(runtimeEmbeddedDir, "dist", "esm"), { recursive: true });
    await mkdir(join(runtimeEmbeddedDir, "dist", "web"), { recursive: true });
    await writeFile(
      join(runtimeEmbeddedDir, "runtime-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.5.5",
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      join(runtimeEmbeddedDir, "dist", "esm", "runtime-launch-entry.mjs"),
      "export {};\n"
    );
    await writeFile(join(runtimeEmbeddedDir, "dist", "web", "index.html"), "<html></html>\n");

    const prepared = await prepareDesktopLocalSmokeUserData({
      repoRoot,
      now: () => 1700000001234,
    });

    expect(prepared.userDataDir).toBe(join(repoRoot, ".tmp", "desktop-local-smoke", "user-data"));
    expect(prepared.runtimeVersion).toBe("0.5.5");
    expect(
      JSON.parse(
        await readFile(join(prepared.userDataDir, "runtime-store", "current.json"), "utf-8")
      )
    ).toEqual({
      version: "0.5.5",
      installedAt: 1700000001234,
      path: join(prepared.userDataDir, "runtime-store", "versions", "0.5.5"),
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "local-desktop-seed",
      source: "local-desktop-seed",
    });
    await expect(
      readFile(
        join(
          prepared.userDataDir,
          "runtime-store",
          "versions",
          "0.5.5",
          "dist",
          "web",
          "index.html"
        ),
        "utf-8"
      )
    ).resolves.toBe("<html></html>\n");
  });

  it("builds desktop assets before launching Electron with the isolated userData dir", async () => {
    const buildWebApp = vi.fn(async () => {});
    const buildDesktopApp = vi.fn(async () => {});
    const prepareLocalUserData = vi.fn(async () => ({
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      runtimeVersion: "0.5.5",
    }));
    const runCommand = vi.fn<SmokeScriptRunner>().mockResolvedValue(undefined);

    await runDesktopSmokeLocal({
      repoRoot: "/repo",
      buildWebApp,
      buildDesktopApp,
      prepareLocalUserData,
      runCommand,
      env: {
        PATH: "/usr/bin",
      },
    });

    expect(buildWebApp).toHaveBeenCalledTimes(1);
    expect(buildDesktopApp.mock.invocationCallOrder[0]).toBeGreaterThan(
      buildWebApp.mock.invocationCallOrder[0]
    );
    expect(buildDesktopApp).toHaveBeenCalledTimes(1);
    expect(prepareLocalUserData).toHaveBeenCalledWith({
      repoRoot: "/repo",
    });
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--filter", "@coder-studio/desktop", "exec", "electron", "dist/electron/main.mjs"],
      {
        cwd: "/repo",
        env: {
          PATH: "/usr/bin",
          CODER_STUDIO_DESKTOP_USER_DATA_DIR: "/repo/.tmp/desktop-local-smoke/user-data",
        },
      }
    );
  });

  it("waits for the desktop runtime to become healthy and removes isolated userData by default", async () => {
    const child = createChildProcess();
    const runBackground = vi.fn(() => child);
    const waitForDesktopHealthy = vi.fn(async () => ({
      browserUrl: "http://127.0.0.1:43123",
      runtime: {
        host: "127.0.0.1",
        port: 43123,
        pid: 4242,
        token: "server-4242",
        serverInstanceId: "server-4242",
        startedAt: 1700000001234,
      },
    }));
    const removeDir = vi.fn(async () => {});

    const launch = await launchDesktopSmokeLocal({
      repoRoot: "/repo",
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      env: {
        PATH: "/usr/bin",
      },
      runBackground,
      waitForDesktopHealthy,
      removeDir,
    });

    expect(runBackground).toHaveBeenCalledWith(
      "pnpm",
      ["--filter", "@coder-studio/desktop", "exec", "electron", "dist/electron/main.mjs"],
      {
        cwd: "/repo",
        env: {
          PATH: "/usr/bin",
          CODER_STUDIO_DESKTOP_USER_DATA_DIR: "/repo/.tmp/desktop-local-smoke/user-data",
        },
        stdio: "inherit",
      }
    );
    expect(waitForDesktopHealthy).toHaveBeenCalledWith({
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      expectedPid: 4242,
    });
    expect(launch.browserUrl).toBe("http://127.0.0.1:43123");

    child.emit("close", 0, null);
    await launch.completed;

    expect(removeDir).toHaveBeenCalledWith("/repo/.tmp/desktop-local-smoke/user-data");
  });

  it("keeps isolated userData when requested", async () => {
    const child = createChildProcess();
    const runBackground = vi.fn(() => child);
    const waitForDesktopHealthy = vi.fn(async () => ({
      browserUrl: "http://127.0.0.1:43123",
      runtime: {
        host: "127.0.0.1",
        port: 43123,
        pid: 4242,
        token: "server-4242",
        serverInstanceId: "server-4242",
        startedAt: 1700000001234,
      },
    }));
    const removeDir = vi.fn(async () => {});

    const launch = await launchDesktopSmokeLocal({
      repoRoot: "/repo",
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      keepUserData: true,
      runBackground,
      waitForDesktopHealthy,
      removeDir,
    });

    child.emit("close", 0, null);
    await launch.completed;

    expect(removeDir).not.toHaveBeenCalled();
  });

  it("retries cleanup when Windows temporarily locks the smoke userData dir", async () => {
    const child = createChildProcess();
    const runBackground = vi.fn(() => child);
    const waitForDesktopHealthy = vi.fn(async () => ({
      browserUrl: "http://127.0.0.1:43123",
      runtime: {
        host: "127.0.0.1",
        port: 43123,
        pid: 4242,
        token: "server-4242",
        serverInstanceId: "server-4242",
        startedAt: 1700000001234,
      },
    }));
    const removeDir = vi.fn(async () => {
      if (removeDir.mock.calls.length === 1) {
        const error = new Error("EBUSY") as Error & { code?: string };
        error.code = "EBUSY";
        throw error;
      }
    });

    const launch = await launchDesktopSmokeLocal({
      repoRoot: "/repo",
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      runBackground,
      waitForDesktopHealthy,
      removeDir,
    });

    child.emit("close", 0, null);
    await launch.completed;

    expect(removeDir.mock.calls.length).toBeGreaterThan(1);
  });

  it("fails fast when Electron exits before the desktop runtime becomes healthy", async () => {
    const child = createChildProcess();
    const runBackground = vi.fn(() => child);
    const waitForDesktopHealthy = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ browserUrl: "http://127.0.0.1:43123", runtime: {} as never }),
            50
          );
        })
    );
    const removeDir = vi.fn(async () => {});

    const launchPromise = launchDesktopSmokeLocal({
      repoRoot: "/repo",
      userDataDir: "/repo/.tmp/desktop-local-smoke/user-data",
      runBackground,
      waitForDesktopHealthy,
      removeDir,
    });

    child.emit("close", 1, null);

    await expect(launchPromise).rejects.toThrow(
      "Desktop smoke Electron exited before becoming healthy (code 1)"
    );
    expect(removeDir).toHaveBeenCalledWith("/repo/.tmp/desktop-local-smoke/user-data");
  });

  it("parses the keep-user-data CLI flag", () => {
    expect(parseDesktopSmokeLocalArgs([])).toEqual({
      keepUserData: false,
    });
    expect(parseDesktopSmokeLocalArgs(["--keep-user-data"])).toEqual({
      keepUserData: true,
    });
  });
});
