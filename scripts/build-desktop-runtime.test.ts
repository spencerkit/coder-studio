import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDesktopRuntimeBundle,
  createDesktopRuntimeManifest,
  createDesktopRuntimePackageJson,
  createDesktopRuntimeServerBuildOptions,
  createDesktopRuntimeWslEntryBuildOptions,
  materializePortableRuntimeDir,
  prepareDesktopRuntimeOutputDirs,
  readDesktopRuntimeVersion,
} from "./build-desktop-runtime.js";
import { DESKTOP_DIR, RUNTIME_DIR } from "./shared/index.js";

describe("build-desktop-runtime", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("cleans stale desktop embedded runtime output before rebuilding", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    tempDirs.push(runtimeDir);
    const esmDir = join(runtimeDir, "dist", "esm");
    const webDir = join(runtimeDir, "dist", "web");

    await mkdir(esmDir, { recursive: true });
    await mkdir(webDir, { recursive: true });
    await writeFile(join(esmDir, "old-entry.mjs"), "old");
    await writeFile(join(webDir, "old-index.html"), "old");

    await prepareDesktopRuntimeOutputDirs({
      runtimeDir,
      esmDir,
      webDir,
    });

    await expect(readdir(esmDir)).resolves.toEqual([]);
    await expect(readdir(webDir)).resolves.toEqual([]);
  });

  it("creates a desktop runtime server bundle config", () => {
    const buildOptions = createDesktopRuntimeServerBuildOptions({
      runtimeDir: "/repo/packages/desktop/dist/runtime/embedded",
      external: ["fastify", "zod"],
    });

    expect(buildOptions.entryPoints).toEqual([resolve(RUNTIME_DIR, "src/runtime-launch-entry.ts")]);
    expect(buildOptions.outfile).toBe(
      "/repo/packages/desktop/dist/runtime/embedded/dist/esm/runtime-launch-entry.mjs"
    );
    expect(buildOptions.external).toEqual(["fastify", "zod"]);
  });

  it("creates a desktop runtime WSL entry bundle config", () => {
    const buildOptions = createDesktopRuntimeWslEntryBuildOptions({
      runtimeDir: "/repo/packages/desktop/dist/runtime/embedded",
      external: ["fastify", "zod"],
    });

    expect(buildOptions.entryPoints).toEqual([resolve(RUNTIME_DIR, "src/wsl-runtime-entry.ts")]);
    expect(buildOptions.outfile).toBe(
      "/repo/packages/desktop/dist/runtime/embedded/dist/esm/wsl-runtime-entry.mjs"
    );
    expect(buildOptions.external).toEqual(["fastify", "zod"]);
  });

  it("creates a deployable desktop runtime package manifest", () => {
    expect(
      createDesktopRuntimePackageJson({
        version: "0.5.4",
        dependencies: {
          fastify: "^5.8.5",
          zod: "^4.4.2",
        },
      })
    ).toEqual({
      name: "@coder-studio/desktop-runtime",
      version: "0.5.4",
      private: true,
      type: "module",
      main: "./dist/esm/runtime-launch-entry.mjs",
      exports: {
        ".": {
          import: "./dist/esm/runtime-launch-entry.mjs",
        },
      },
      files: ["dist", "runtime-manifest.json", "package.json"],
      dependencies: {
        fastify: "^5.8.5",
        zod: "^4.4.2",
      },
    });
  });

  it("drops internal workspace dependencies from the deployable runtime package manifest", () => {
    expect(
      createDesktopRuntimePackageJson({
        version: "0.5.4",
        dependencies: {
          "@coder-studio/core": "workspace:*",
          "@coder-studio/providers": "workspace:*",
          fastify: "^5.8.5",
          zod: "^4.4.2",
        },
      })
    ).toEqual({
      name: "@coder-studio/desktop-runtime",
      version: "0.5.4",
      private: true,
      type: "module",
      main: "./dist/esm/runtime-launch-entry.mjs",
      exports: {
        ".": {
          import: "./dist/esm/runtime-launch-entry.mjs",
        },
      },
      files: ["dist", "runtime-manifest.json", "package.json"],
      dependencies: {
        fastify: "^5.8.5",
        zod: "^4.4.2",
      },
    });
  });

  it("creates a stable runtime manifest", () => {
    expect(
      createDesktopRuntimeManifest({
        version: "0.5.4",
      })
    ).toEqual({
      schemaVersion: 1,
      version: "0.5.4",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
    });
  });

  it("reads the runtime version from the CLI package when the workspace root is unversioned", async () => {
    const version = await readDesktopRuntimeVersion({
      rootPackageJsonPath: resolve(DESKTOP_DIR, "..", "..", "package.json"),
      cliPackageJsonPath: resolve(DESKTOP_DIR, "..", "cli", "package.json"),
    });

    expect(version).toBe("0.5.4");
  });

  it("builds a desktop runtime bundle with server output, web assets, and manifest", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    const webSourceDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-web-"));
    const tempWorkspaceDir = await mkdtemp(
      join(tmpdir(), "coder-studio-desktop-runtime-workspace-")
    );
    tempDirs.push(runtimeDir, webSourceDir);
    await mkdir(join(webSourceDir, "assets"), { recursive: true });
    await writeFile(join(webSourceDir, "index.html"), "<html>runtime</html>\n");
    await writeFile(join(webSourceDir, "assets", "app.js"), "console.log('runtime');\n");

    const esbuildBuild = vi.fn(async (options) => {
      const outfile = options.outfile;
      if (typeof outfile !== "string") {
        throw new Error("missing outfile");
      }
      await mkdir(resolve(outfile, ".."), { recursive: true });
      await writeFile(outfile, "export const runtime = true;\n");
    });
    const exec = vi.fn(async (_command: string, args: string[], options?: { cwd?: string }) => {
      expect(options?.cwd).toBe(tempWorkspaceDir);
      expect(args).toEqual([
        "--filter",
        "@coder-studio/desktop-runtime",
        "deploy",
        "--legacy",
        "--prod",
        "--offline",
        runtimeDir,
      ]);
      const runtimePackageDir = join(tempWorkspaceDir, "packages", "runtime");
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        join(runtimeDir, "package.json"),
        await readFile(join(runtimePackageDir, "package.json"), "utf-8")
      );
      await writeFile(
        join(runtimeDir, "runtime-manifest.json"),
        await readFile(join(runtimePackageDir, "runtime-manifest.json"), "utf-8")
      );
      await mkdir(join(runtimeDir, "dist", "esm"), { recursive: true });
      await mkdir(join(runtimeDir, "dist", "web", "assets"), { recursive: true });
      await writeFile(
        join(runtimeDir, "dist", "esm", "runtime-launch-entry.mjs"),
        await readFile(join(runtimePackageDir, "dist", "esm", "runtime-launch-entry.mjs"), "utf-8")
      );
      await writeFile(
        join(runtimeDir, "dist", "esm", "wsl-runtime-entry.mjs"),
        await readFile(join(runtimePackageDir, "dist", "esm", "wsl-runtime-entry.mjs"), "utf-8")
      );
      await writeFile(
        join(runtimeDir, "dist", "web", "index.html"),
        await readFile(join(runtimePackageDir, "dist", "web", "index.html"), "utf-8")
      );
      await writeFile(
        join(runtimeDir, "dist", "web", "assets", "app.js"),
        await readFile(join(runtimePackageDir, "dist", "web", "assets", "app.js"), "utf-8")
      );
    });

    await buildDesktopRuntimeBundle({
      runtimeDir,
      runtimeVersion: "0.5.4",
      webSourceDir,
      dependencyVersions: {
        fastify: "^5.8.5",
      },
      esbuildBuild,
      exec,
      tempWorkspaceDir,
    });

    expect(esbuildBuild).toHaveBeenCalledTimes(2);
    expect(esbuildBuild).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outfile: join(
          tempWorkspaceDir,
          "packages",
          "runtime",
          "dist",
          "esm",
          "runtime-launch-entry.mjs"
        ),
      })
    );
    expect(esbuildBuild).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outfile: join(
          tempWorkspaceDir,
          "packages",
          "runtime",
          "dist",
          "esm",
          "wsl-runtime-entry.mjs"
        ),
      })
    );
    expect(exec).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(runtimeDir, "dist", "esm", "wsl-runtime-entry.mjs"), "utf-8")
    ).resolves.toBe("export const runtime = true;\n");
    await expect(readFile(join(runtimeDir, "runtime-manifest.json"), "utf-8")).resolves.toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.5.4",
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )}\n`
    );
    await expect(readFile(join(runtimeDir, "dist", "web", "index.html"), "utf-8")).resolves.toBe(
      "<html>runtime</html>\n"
    );
    await expect(
      readFile(join(runtimeDir, "dist", "web", "assets", "app.js"), "utf-8")
    ).resolves.toBe("console.log('runtime');\n");
    await expect(
      readFile(join(runtimeDir, "package.json"), "utf-8").then((raw) => JSON.parse(raw))
    ).resolves.toMatchObject({
      name: "@coder-studio/desktop-runtime",
      version: "0.5.4",
      dependencies: {
        fastify: "^5.8.5",
      },
    });
  });

  it("cleans an existing runtime bundle output directory before deploy", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    const webSourceDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-web-"));
    const tempWorkspaceDir = await mkdtemp(
      join(tmpdir(), "coder-studio-desktop-runtime-workspace-")
    );
    tempDirs.push(runtimeDir, webSourceDir);

    await writeFile(join(runtimeDir, "stale.txt"), "stale\n");
    await writeFile(join(webSourceDir, "index.html"), "<html>runtime</html>\n");

    const esbuildBuild = vi.fn(async (options) => {
      const outfile = options.outfile;
      if (typeof outfile !== "string") {
        throw new Error("missing outfile");
      }
      await mkdir(resolve(outfile, ".."), { recursive: true });
      await writeFile(outfile, "export const runtime = true;\n");
    });
    const exec = vi.fn(async () => {
      await expect(readdir(runtimeDir)).rejects.toMatchObject({ code: "ENOENT" });
      await mkdir(runtimeDir, { recursive: true });
    });

    await buildDesktopRuntimeBundle({
      runtimeDir,
      runtimeVersion: "0.5.4",
      webSourceDir,
      dependencyVersions: {
        fastify: "^5.8.5",
      },
      esbuildBuild,
      exec,
      tempWorkspaceDir,
    });
  });

  it("retries deploy without offline mode when offline metadata is unavailable", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    const webSourceDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-web-"));
    const tempWorkspaceDir = await mkdtemp(
      join(tmpdir(), "coder-studio-desktop-runtime-workspace-")
    );
    tempDirs.push(runtimeDir, webSourceDir);

    await writeFile(join(webSourceDir, "index.html"), "<html>runtime</html>\n");

    const esbuildBuild = vi.fn(async (options) => {
      const outfile = options.outfile;
      if (typeof outfile !== "string") {
        throw new Error("missing outfile");
      }
      await mkdir(resolve(outfile, ".."), { recursive: true });
      await writeFile(outfile, "export const runtime = true;\n");
    });
    const exec = vi
      .fn<(command: string, args: string[], options?: { cwd?: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("ERR_PNPM_NO_OFFLINE_META"))
      .mockImplementationOnce(async (_command, args) => {
        expect(args).toEqual([
          "--filter",
          "@coder-studio/desktop-runtime",
          "deploy",
          "--legacy",
          "--prod",
          runtimeDir,
        ]);
        await mkdir(runtimeDir, { recursive: true });
      });

    await buildDesktopRuntimeBundle({
      runtimeDir,
      runtimeVersion: "0.5.4",
      webSourceDir,
      dependencyVersions: {
        fastify: "^5.8.5",
      },
      esbuildBuild,
      exec,
      tempWorkspaceDir,
    });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      [
        "--filter",
        "@coder-studio/desktop-runtime",
        "deploy",
        "--legacy",
        "--prod",
        "--offline",
        runtimeDir,
      ],
      { cwd: tempWorkspaceDir, stdio: "pipe" }
    );
  });

  it("materializes symlinked dependencies into a portable embedded runtime directory", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-runtime-embedded-"));
    tempDirs.push(runtimeDir);

    const packageStoreDir = join(runtimeDir, "node_modules", ".pnpm", "dep@1.0.0", "node_modules");
    const realPackageDir = join(packageStoreDir, "dep");
    const linkedPackageDir = join(runtimeDir, "node_modules", "dep");

    await mkdir(realPackageDir, { recursive: true });
    await writeFile(join(realPackageDir, "index.js"), "export const dep = true;\n");
    await symlink(realPackageDir, linkedPackageDir, "dir");

    await materializePortableRuntimeDir(runtimeDir);

    await expect(
      lstat(join(runtimeDir, "node_modules", "dep")).then((stats) => stats.isSymbolicLink())
    ).resolves.toBe(false);
    await expect(
      readFile(join(runtimeDir, "node_modules", "dep", "index.js"), "utf-8")
    ).resolves.toBe("export const dep = true;\n");
  });
});
