import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDesktopRuntimeBundle,
  cleanupDesktopRuntimeDependencyMetadata,
  cleanupDesktopRuntimeInstallArtifacts,
  createDesktopRuntimeExternalDependencies,
  createDesktopRuntimeInstalledDependencies,
  createDesktopRuntimeManifest,
  createDesktopRuntimePackageJson,
  createDesktopRuntimeServerBuildOptions,
  createDesktopRuntimeWslEntryBuildOptions,
  installDesktopRuntimeDependencies,
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
    expect(buildOptions.packages).toBe("external");
    expect(buildOptions.external).toEqual(["node-pty"]);
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
    expect(buildOptions.packages).toBe("external");
    expect(buildOptions.external).toEqual(["node-pty"]);
  });

  it("creates a desktop runtime package manifest with deployable third-party runtime dependencies", () => {
    expect(
      createDesktopRuntimePackageJson({
        version: "0.5.4",
        dependencies: {
          "@coder-studio/core": "workspace:*",
          "@coder-studio/providers": "workspace:*",
          "@coder-studio/utils": "workspace:*",
          "@fastify/compress": "^8.3.1",
          fastify: "^5.8.5",
          "mime-types": "^2.1.35",
          "node-pty": "^1.1.0",
          "typescript-language-server": "^5.2.0",
          typescript: "^6.0.3",
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
        "@fastify/compress": "^8.3.1",
        fastify: "^5.8.5",
        "mime-types": "^2.1.35",
        "node-pty": "^1.1.0",
        "typescript-language-server": "^5.2.0",
        typescript: "^6.0.3",
        zod: "^4.4.2",
      },
    });
  });

  it("keeps only native runtime packages in the embedded runtime external dependency list", () => {
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

  it("keeps deployable third-party runtime packages in the embedded runtime install dependency list", () => {
    expect(
      createDesktopRuntimeInstalledDependencies({
        "@coder-studio/core": "workspace:*",
        "@coder-studio/providers": "workspace:*",
        fastify: "^5.8.5",
        "mime-types": "^2.1.35",
        "node-pty": "^1.1.0",
        "typescript-language-server": "^5.2.0",
        typescript: "^6.0.3",
        "vscode-jsonrpc": "^8.2.1",
        zod: "^4.4.2",
      })
    ).toEqual({
      fastify: "^5.8.5",
      "mime-types": "^2.1.35",
      "node-pty": "^1.1.0",
      "typescript-language-server": "^5.2.0",
      typescript: "^6.0.3",
      "vscode-jsonrpc": "^8.2.1",
      zod: "^4.4.2",
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

    const installDependencies = vi.fn(async () => {});
    const cleanupInstallArtifacts = vi.fn(async () => {});
    const cleanupDependencyMetadata = vi.fn(async () => {});
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
      installDependencies,
      cleanupInstallArtifacts,
      cleanupDependencyMetadata,
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
    expect(installDependencies).toHaveBeenCalledWith({
      runtimeDir,
    });
    expect(cleanupInstallArtifacts).toHaveBeenCalledWith({
      runtimeDir,
    });
    expect(cleanupDependencyMetadata).toHaveBeenCalledWith({
      runtimeDir,
    });
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
      dependencies: {
        fastify: "^5.8.5",
        "mime-types": "^2.1.35",
        "node-pty": "^1.1.0",
        "typescript-language-server": "^5.2.0",
        typescript: "^6.0.3",
      },
    });
  });

  it("retries dependency install without offline mode when pnpm metadata is unavailable", async () => {
    const exec = vi
      .fn<
        (
          command: string,
          args: string[],
          options?: { cwd?: string; stdio?: "pipe" }
        ) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("ERR_PNPM_NO_OFFLINE_META"))
      .mockResolvedValueOnce();

    await installDesktopRuntimeDependencies({
      runtimeDir: "/repo/packages/desktop/dist/runtime/embedded",
      exec,
    });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      [
        "install",
        "--prod",
        "--offline",
        "--ignore-workspace",
        "--config.node-linker=hoisted",
        "--config.package-import-method=copy",
        "--config.confirmModulesPurge=false",
      ],
      {
        cwd: "/repo/packages/desktop/dist/runtime/embedded",
        stdio: "pipe",
      }
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      [
        "install",
        "--prod",
        "--ignore-workspace",
        "--config.node-linker=hoisted",
        "--config.package-import-method=copy",
        "--config.confirmModulesPurge=false",
      ],
      {
        cwd: "/repo/packages/desktop/dist/runtime/embedded",
        stdio: "pipe",
      }
    );
  });

  it("retries dependency install without offline mode when pnpm tarballs are unavailable offline", async () => {
    const exec = vi
      .fn<
        (
          command: string,
          args: string[],
          options?: { cwd?: string; stdio?: "pipe" }
        ) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("ERR_PNPM_NO_OFFLINE_TARBALL"))
      .mockResolvedValueOnce();

    await installDesktopRuntimeDependencies({
      runtimeDir: "/repo/packages/desktop/dist/runtime/embedded",
      exec,
    });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      [
        "install",
        "--prod",
        "--offline",
        "--ignore-workspace",
        "--config.node-linker=hoisted",
        "--config.package-import-method=copy",
        "--config.confirmModulesPurge=false",
      ],
      {
        cwd: "/repo/packages/desktop/dist/runtime/embedded",
        stdio: "pipe",
      }
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      [
        "install",
        "--prod",
        "--ignore-workspace",
        "--config.node-linker=hoisted",
        "--config.package-import-method=copy",
        "--config.confirmModulesPurge=false",
      ],
      {
        cwd: "/repo/packages/desktop/dist/runtime/embedded",
        stdio: "pipe",
      }
    );
  });

  it("removes pnpm install artifacts that should not ship inside the embedded runtime", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    tempDirs.push(runtimeDir);
    const nodeModulesDir = join(runtimeDir, "node_modules");
    const packageDir = join(nodeModulesDir, "typescript");

    await mkdir(join(nodeModulesDir, ".bin"), { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(nodeModulesDir, ".modules.yaml"), "layout-version: 5\n");
    await writeFile(join(nodeModulesDir, ".pnpm-workspace-state-v1.json"), "{}\n");
    await writeFile(join(packageDir, "package.json"), '{"name":"typescript"}\n');

    await cleanupDesktopRuntimeInstallArtifacts({ runtimeDir });

    await expect(readdir(nodeModulesDir)).resolves.toEqual(["typescript"]);
    await expect(readFile(join(packageDir, "package.json"), "utf-8")).resolves.toBe(
      '{"name":"typescript"}\n'
    );
  });

  it("removes pnpm metadata while keeping installed package directories intact", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-"));
    tempDirs.push(runtimeDir);
    const nodeModulesDir = join(runtimeDir, "node_modules");
    const pnpmDir = join(nodeModulesDir, ".pnpm", "dep@1.0.0");
    const packageDir = join(nodeModulesDir, "typescript-language-server");

    await mkdir(pnpmDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(pnpmDir, "state.json"), "{}\n");
    await writeFile(join(packageDir, "package.json"), '{"name":"typescript-language-server"}\n');

    await cleanupDesktopRuntimeDependencyMetadata({ runtimeDir });

    await expect(readdir(nodeModulesDir)).resolves.toEqual(["typescript-language-server"]);
    await expect(readFile(join(packageDir, "package.json"), "utf-8")).resolves.toBe(
      '{"name":"typescript-language-server"}\n'
    );
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
      installDependencies: vi.fn(async () => {}),
      cleanupInstallArtifacts: vi.fn(async () => {}),
      cleanupDependencyMetadata: vi.fn(async () => {}),
      copyStaticAssets: vi.fn(async () => {}),
    });
  });
});
