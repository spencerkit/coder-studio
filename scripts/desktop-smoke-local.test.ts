import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareDesktopLocalSmokeUserData,
  runDesktopSmokeLocal,
  type SmokeScriptRunner,
} from "./desktop-smoke-local.js";

describe("desktop-smoke-local", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("seeds the isolated runtime-store from the bundled desktop runtime", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-desktop-smoke-"));
    tempDirs.push(repoRoot);

    const runtimeSeedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "seed");
    await mkdir(join(runtimeSeedDir, "dist", "esm"), { recursive: true });
    await mkdir(join(runtimeSeedDir, "dist", "web"), { recursive: true });
    await writeFile(
      join(runtimeSeedDir, "runtime-manifest.json"),
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
      join(runtimeSeedDir, "dist", "esm", "runtime-launch-entry.mjs"),
      "export {};\n"
    );
    await writeFile(join(runtimeSeedDir, "dist", "web", "index.html"), "<html></html>\n");

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
});
