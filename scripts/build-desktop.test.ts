import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDesktopPackage,
  createDesktopBuildOptions,
  createDesktopPackageStageDir,
  materializeDesktopReleaseDir,
  packageDesktopInstallers,
  prepareDesktopOutputDirs,
  resolveDesktopReleaseDir,
  resolveEmbeddedNodeOutputName,
  shouldPackageDesktop,
} from "./build-desktop.js";
import { CORE_DIR, DESKTOP_DIR } from "./shared/index.js";

describe("build-desktop", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("cleans stale desktop output before packaging", async () => {
    const desktopDistDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-dist-"));
    tempDirs.push(desktopDistDir);
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

  it("overrides the electron-builder output dir when packaging through a staging directory", async () => {
    const run = vi.fn(async () => {});

    await buildDesktopPackage({
      exec: run,
      desktopDir: "/repo/packages/desktop",
      outputDir: "/tmp/coder-studio-desktop-release-stage",
    });

    expect(run).toHaveBeenCalledWith(
      "pnpm",
      [
        "exec",
        "electron-builder",
        "--projectDir",
        "/repo/packages/desktop",
        "--config.directories.output=/tmp/coder-studio-desktop-release-stage",
      ],
      expect.objectContaining({ cwd: "/repo/packages/desktop" })
    );
  });

  it("creates the default desktop package staging dir inside the desktop project tmp directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-stage-root-"));
    tempDirs.push(rootDir);
    const desktopDir = join(rootDir, "packages", "desktop");

    const stagedDir = await createDesktopPackageStageDir(desktopDir);
    tempDirs.push(stagedDir);

    expect(stagedDir).toMatch(
      new RegExp(`^${join(desktopDir, ".tmp", "release-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  });

  it("materializes staged release artifacts into the final desktop release directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-release-materialize-"));
    tempDirs.push(rootDir);
    const stagedReleaseDir = join(rootDir, "release-stage");
    const releaseDir = join(rootDir, "dist", "release");

    await mkdir(join(stagedReleaseDir, "win-unpacked"), { recursive: true });
    await writeFile(join(stagedReleaseDir, "latest.yml"), "version: 0.5.4\n");
    await writeFile(join(stagedReleaseDir, "win-unpacked", "Coder Studio.exe"), "binary");
    await mkdir(join(releaseDir, "stale"), { recursive: true });
    await writeFile(join(releaseDir, "stale", "old.txt"), "old");

    await materializeDesktopReleaseDir({
      stagedReleaseDir,
      releaseDir,
    });

    await expect(readFile(join(releaseDir, "latest.yml"), "utf-8")).resolves.toBe(
      "version: 0.5.4\n"
    );
    await expect(
      readFile(join(releaseDir, "win-unpacked", "Coder Studio.exe"), "utf-8")
    ).resolves.toBe("binary");
    await expect(access(join(releaseDir, "stale", "old.txt"))).rejects.toThrow();
  });

  it("packages installers through a staged release dir and cleans the staging output afterward", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-package-stage-"));
    tempDirs.push(rootDir);
    const desktopDir = join(rootDir, "packages", "desktop");
    const desktopDistDir = join(desktopDir, "dist");
    const stageRootDir = join(rootDir, "staging");
    const releaseDir = resolveDesktopReleaseDir(desktopDistDir);
    let stagedReleaseDir = "";

    await mkdir(stageRootDir, { recursive: true });

    const exec = vi.fn(async (_command: string, args: string[]) => {
      const outputArg = args.find((arg) => arg.startsWith("--config.directories.output="));
      if (!outputArg) {
        throw new Error("missing staged release dir");
      }
      stagedReleaseDir = outputArg.slice("--config.directories.output=".length);
      await mkdir(join(stagedReleaseDir, "win-unpacked"), { recursive: true });
      await writeFile(join(stagedReleaseDir, "win-unpacked", "Coder Studio.exe"), "binary");
    });

    const builtReleaseDir = await packageDesktopInstallers({
      exec,
      desktopDir,
      desktopDistDir,
      createStageDir: () => mkdtemp(join(stageRootDir, "release-")),
    });

    expect(builtReleaseDir).toBe(releaseDir);
    await expect(
      readFile(join(releaseDir, "win-unpacked", "Coder Studio.exe"), "utf-8")
    ).resolves.toBe("binary");
    await expect(access(stagedReleaseDir)).rejects.toThrow();
  });

  it("cleans the staged release dir when electron-builder packaging fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-package-failure-"));
    tempDirs.push(rootDir);
    const desktopDir = join(rootDir, "packages", "desktop");
    const desktopDistDir = join(desktopDir, "dist");
    const stagedReleaseDir = join(rootDir, "release-stage");

    const exec = vi.fn(async () => {
      await mkdir(stagedReleaseDir, { recursive: true });
      await writeFile(join(stagedReleaseDir, "partial.txt"), "partial");
      throw new Error("electron-builder failed");
    });

    await expect(
      packageDesktopInstallers({
        exec,
        desktopDir,
        desktopDistDir,
        createStageDir: async () => stagedReleaseDir,
      })
    ).rejects.toThrow("electron-builder failed");
    await expect(access(stagedReleaseDir)).rejects.toThrow();
  });

  it("skips installer packaging on unsupported host platforms", () => {
    expect(shouldPackageDesktop("linux")).toBe(false);
    expect(shouldPackageDesktop("darwin")).toBe(true);
    expect(shouldPackageDesktop("win32")).toBe(true);
  });
});
