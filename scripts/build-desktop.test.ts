import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopPackage,
  createDesktopBuildOptions,
  prepareDesktopDeployWorkspace,
  prepareDesktopOutputDirs,
  resolveEmbeddedNodeOutputName,
  shouldPackageDesktop,
  stageCliRuntimeBundle,
} from "./build-desktop.js";
import { CORE_DIR, DESKTOP_DIR } from "./shared/index.js";

async function createCliDeployFixture(): Promise<{ rootDir: string; cliDir: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "coder-studio-desktop-runtime-fixture-"));
  const cliDir = join(rootDir, "packages", "cli");

  await mkdir(join(cliDir, "dist", "esm"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({ name: "fixture-root", private: true, packageManager: "pnpm@10.17.1" }, null, 2)
  );
  await writeFile(join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(
    join(cliDir, "package.json"),
    JSON.stringify(
      {
        name: "@spencer-kit/coder-studio",
        version: "0.5.4",
        private: true,
        type: "module",
        main: "./src/index.ts",
        bin: {
          "coder-studio": "./src/bin.ts",
        },
        exports: {
          ".": {
            import: "./src/index.ts",
          },
        },
        files: ["dist", "src", "README.md", "CHANGELOG.md", "package.json"],
        publishConfig: {
          main: "./dist/esm/index.mjs",
          bin: {
            "coder-studio": "./dist/bin.js",
          },
          exports: {
            ".": {
              import: "./dist/esm/index.mjs",
            },
          },
        },
        scripts: {
          build: "tsx ../../scripts/build-cli.ts",
        },
        dependencies: {
          zod: "^4.4.2",
        },
        devDependencies: {
          "@coder-studio/core": "workspace:*",
        },
      },
      null,
      2
    )
  );
  await writeFile(join(cliDir, "dist", "bin.js"), "#!/usr/bin/env node\n");
  await writeFile(join(cliDir, "dist", "esm", "index.mjs"), "export const runtime = true;\n");
  await writeFile(
    join(cliDir, "dist", "esm", "desktop-server.mjs"),
    "export const desktop = true;\n"
  );

  return { rootDir, cliDir };
}

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

  it("invokes electron-builder with publish disabled", async () => {
    const run = vi.fn(async () => {});

    await buildDesktopPackage({
      exec: run,
      desktopDir: "/repo/packages/desktop",
    });

    expect(run).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "electron-builder", "--projectDir", "/repo/packages/desktop", "--publish", "never"],
      expect.objectContaining({ cwd: "/repo/packages/desktop" })
    );
  });

  it("prepares a minimal deploy workspace with built CLI runtime assets", async () => {
    const { rootDir, cliDir } = await createCliDeployFixture();
    const tempWorkspaceDir = join(rootDir, "desktop-runtime-workspace");

    await prepareDesktopDeployWorkspace({
      rootDir,
      cliDir,
      tempWorkspaceDir,
    });

    await expect(readFile(join(tempWorkspaceDir, "pnpm-workspace.yaml"), "utf-8")).resolves.toBe(
      "packages:\n  - packages/cli\n"
    );

    await expect(readFile(join(tempWorkspaceDir, "package.json"), "utf-8")).resolves.toBe(
      `${JSON.stringify(
        {
          name: "coder-studio-desktop-runtime-workspace",
          private: true,
          packageManager: "pnpm@10.17.1",
        },
        null,
        2
      )}\n`
    );

    await expect(
      readFile(
        join(tempWorkspaceDir, "packages", "cli", "dist", "esm", "desktop-server.mjs"),
        "utf-8"
      )
    ).resolves.toBe("export const desktop = true;\n");

    await expect(
      readFile(join(tempWorkspaceDir, "packages", "cli", "package.json"), "utf-8").then(
        (value) =>
          JSON.parse(value) as {
            main?: string;
            bin?: Record<string, string>;
            exports?: Record<string, { import?: string }>;
            files?: string[];
            publishConfig?: unknown;
            scripts?: unknown;
            devDependencies?: unknown;
          }
      )
    ).resolves.toEqual({
      name: "@spencer-kit/coder-studio",
      version: "0.5.4",
      private: true,
      type: "module",
      main: "./dist/esm/index.mjs",
      bin: {
        "coder-studio": "./dist/bin.js",
      },
      exports: {
        ".": {
          import: "./dist/esm/index.mjs",
        },
      },
      files: ["dist", "package.json"],
      dependencies: {
        zod: "^4.4.2",
      },
    });
  });

  it("deploys the CLI runtime from a temporary offline workspace", async () => {
    const run = vi.fn(async () => {});
    const { rootDir, cliDir } = await createCliDeployFixture();
    const tempWorkspaceDir = join(rootDir, "desktop-runtime-workspace");

    await stageCliRuntimeBundle({
      exec: run,
      rootDir,
      cliDir,
      runtimeCliDir: "/repo/packages/desktop/dist/runtime/cli",
      tempWorkspaceDir,
    });

    expect(run).toHaveBeenCalledWith(
      "pnpm",
      [
        "--filter",
        "@spencer-kit/coder-studio",
        "deploy",
        "--legacy",
        "--prod",
        "--offline",
        "/repo/packages/desktop/dist/runtime/cli",
      ],
      expect.objectContaining({ cwd: tempWorkspaceDir })
    );
  });

  it("removes the temporary deploy workspace after staging completes", async () => {
    const { rootDir, cliDir } = await createCliDeployFixture();
    const tempWorkspaceDir = join(rootDir, "desktop-runtime-workspace");
    const runtimeCliDir = join(rootDir, "desktop-runtime");

    const run = vi.fn(async (_command: string, _args: string[], options?: { cwd?: string }) => {
      if (options?.cwd !== tempWorkspaceDir) {
        throw new Error(`unexpected cwd: ${options?.cwd}`);
      }

      await mkdir(runtimeCliDir, { recursive: true });
      await writeFile(join(runtimeCliDir, "package.json"), "{}\n");
    });

    await stageCliRuntimeBundle({
      exec: run,
      rootDir,
      cliDir,
      runtimeCliDir,
      tempWorkspaceDir,
    });

    await expect(access(tempWorkspaceDir)).rejects.toThrow();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("skips installer packaging on unsupported host platforms", () => {
    expect(shouldPackageDesktop("linux")).toBe(false);
    expect(shouldPackageDesktop("darwin")).toBe(true);
    expect(shouldPackageDesktop("win32")).toBe(true);
  });
});
