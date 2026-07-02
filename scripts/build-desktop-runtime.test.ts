import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDesktopRuntimeBundle,
  createDesktopRuntimeExternalDependencies,
  createDesktopRuntimeManifest,
  createDesktopRuntimePackageJson,
  createDesktopRuntimeServerBuildOptions,
  createDesktopRuntimeWslEntryBuildOptions,
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
      external: ["node-pty"],
    });

    expect(buildOptions.entryPoints).toEqual([resolve(RUNTIME_DIR, "src/runtime-launch-entry.ts")]);
    expect(buildOptions.outfile).toBe(
      "/repo/packages/desktop/dist/runtime/embedded/dist/esm/runtime-launch-entry.mjs"
    );
    expect(buildOptions.external).toEqual(["node-pty"]);
    expect(buildOptions.packages).toBeUndefined();
  });

  it("creates a desktop runtime WSL entry bundle config", () => {
    const buildOptions = createDesktopRuntimeWslEntryBuildOptions({
      runtimeDir: "/repo/packages/desktop/dist/runtime/embedded",
      external: ["node-pty"],
    });

    expect(buildOptions.entryPoints).toEqual([resolve(RUNTIME_DIR, "src/wsl-runtime-entry.ts")]);
    expect(buildOptions.outfile).toBe(
      "/repo/packages/desktop/dist/runtime/embedded/dist/esm/wsl-runtime-entry.mjs"
    );
    expect(buildOptions.external).toEqual(["node-pty"]);
    expect(buildOptions.packages).toBeUndefined();
  });

  it("creates a desktop runtime package manifest without dependencies", () => {
    expect(
      createDesktopRuntimePackageJson({
        version: "0.5.4",
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
    });
  });

  it("returns only native runtime packages for esbuild externals", () => {
    expect(
      createDesktopRuntimeExternalDependencies({
        "@coder-studio/core": "workspace:*",
        "@coder-studio/providers": "workspace:*",
        fastify: "^5.8.5",
        "node-pty": "^1.1.0",
        "typescript-language-server": "^5.2.0",
        typescript: "^6.0.3",
        zod: "^4.4.2",
      })
    ).toEqual({
      "node-pty": "^1.1.0",
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

  it("builds a desktop runtime bundle with bundled js deps, web assets, and a minimal manifest", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    const webSourceDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-web-"));
    tempDirs.push(runtimeDir, webSourceDir);
    await mkdir(join(webSourceDir, "assets"), { recursive: true });
    await writeFile(join(webSourceDir, "index.html"), "<html>runtime</html>\n");
    await writeFile(join(webSourceDir, "assets", "app.js"), "console.log('runtime');\n");

    const copyStaticAssets = vi.fn(
      async ({ runtimeDir: targetRuntimeDir }: { runtimeDir: string }) => {
        await mkdir(join(targetRuntimeDir, "dist", "assets", "preview"), { recursive: true });
        await writeFile(
          join(targetRuntimeDir, "dist", "assets", "preview", "mermaid.min.js"),
          "window.mermaid = {};\n"
        );
      }
    );
    const esbuildBuild = vi.fn(async (options) => {
      const outfile = options.outfile;
      if (typeof outfile !== "string") {
        throw new Error("missing outfile");
      }
      await mkdir(resolve(outfile, ".."), { recursive: true });
      await writeFile(outfile, "export const runtime = true;\n");
    });
    await buildDesktopRuntimeBundle({
      runtimeDir,
      runtimeVersion: "0.5.4",
      webSourceDir,
      dependencyVersions: {
        fastify: "^5.8.5",
        "mime-types": "^2.1.35",
        "node-pty": "^1.1.0",
        "typescript-language-server": "^5.2.0",
        typescript: "^6.0.3",
      },
      esbuildBuild,
      copyStaticAssets,
    });

    expect(esbuildBuild).toHaveBeenCalledTimes(2);
    expect(esbuildBuild).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outfile: join(runtimeDir, "dist", "esm", "runtime-launch-entry.mjs"),
        external: ["node-pty"],
      })
    );
    expect(esbuildBuild).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outfile: join(runtimeDir, "dist", "esm", "wsl-runtime-entry.mjs"),
        external: ["node-pty"],
      })
    );
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
      readFile(join(runtimeDir, "dist", "assets", "preview", "mermaid.min.js"), "utf-8")
    ).resolves.toBe("window.mermaid = {};\n");
    await expect(
      readFile(join(runtimeDir, "package.json"), "utf-8").then((raw) => JSON.parse(raw))
    ).resolves.toMatchObject({
      name: "@coder-studio/desktop-runtime",
      version: "0.5.4",
    });
  });

  it("cleans an existing runtime bundle output directory before rebuilding", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    const webSourceDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-web-"));
    tempDirs.push(runtimeDir, webSourceDir);

    await writeFile(join(runtimeDir, "stale.txt"), "stale\n");
    await writeFile(join(webSourceDir, "index.html"), "<html>runtime</html>\n");

    const esbuildBuild = vi.fn(async (options) => {
      const outfile = options.outfile;
      if (typeof outfile !== "string") {
        throw new Error("missing outfile");
      }
      await expect(readdir(runtimeDir)).resolves.toEqual(["dist"]);
      await expect(readFile(join(runtimeDir, "stale.txt"), "utf-8")).rejects.toThrow();
      await mkdir(resolve(outfile, ".."), { recursive: true });
      await writeFile(outfile, "export const runtime = true;\n");
    });

    await buildDesktopRuntimeBundle({
      runtimeDir,
      runtimeVersion: "0.5.4",
      webSourceDir,
      dependencyVersions: {
        fastify: "^5.8.5",
      },
      esbuildBuild,
      copyStaticAssets: vi.fn(async () => {}),
    });
  });
});
