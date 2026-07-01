import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopPackage,
  createDesktopBuildOptions,
  prepareDesktopOutputDirs,
  resolveEmbeddedNodeOutputName,
  shouldPackageDesktop,
} from "./build-desktop.js";
import { CORE_DIR, DESKTOP_DIR } from "./shared/index.js";

describe("build-desktop", () => {
  it("cleans stale desktop output before packaging", async () => {
    const desktopDistDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-dist-"));
    const electronDir = join(desktopDistDir, "electron");
    const runtimeDir = join(desktopDistDir, "runtime");

    await mkdir(electronDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(electronDir, "old-main.js"), "old");
    await writeFile(join(runtimeDir, "old-runtime.txt"), "old");

    await prepareDesktopOutputDirs({ desktopDistDir, electronDir, runtimeDir });

    await expect(readdir(electronDir)).resolves.toEqual([]);
    await expect(readdir(runtimeDir)).resolves.toEqual([]);
  });

  it("uses node.exe on Windows and node elsewhere", () => {
    expect(resolveEmbeddedNodeOutputName("win32")).toBe("node.exe");
    expect(resolveEmbeddedNodeOutputName("darwin")).toBe("node");
  });

  it("maps core subpath exports to source files for the desktop bundle", () => {
    const buildOptions = createDesktopBuildOptions();

    expect(buildOptions.entryPoints).toEqual({
      main: resolve(DESKTOP_DIR, "src/main.ts"),
      preload: resolve(DESKTOP_DIR, "src/preload.ts"),
    });

    expect(buildOptions.alias).toMatchObject({
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
    });
  });

  it("invokes electron-builder using the desktop package publish config", async () => {
    const run = vi.fn(async () => {});

    await buildDesktopPackage({
      exec: run,
      desktopDir: "/repo/packages/desktop",
    });

    expect(run).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "electron-builder", "--projectDir", "/repo/packages/desktop"],
      expect.objectContaining({ cwd: "/repo/packages/desktop" })
    );
  });

  it("skips installer packaging on unsupported host platforms", () => {
    expect(shouldPackageDesktop("linux")).toBe(false);
    expect(shouldPackageDesktop("darwin")).toBe(true);
    expect(shouldPackageDesktop("win32")).toBe(true);
  });
});
