import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import {
  CORE_DIR,
  copy,
  copyDir,
  DESKTOP_DIR,
  error,
  log,
  PROVIDERS_DIR,
  ROOT_DIR,
  RUNTIME_DIR,
  SERVER_DIR,
  success,
  UTILS_DIR,
  WEB_DIST_DIR,
} from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const DESKTOP_RUNTIME_NATIVE_EXTERNALS = ["node-pty"] as const;
const DESKTOP_RUNTIME_ASSETS_DIR = "dist/assets";
const MERMAID_ASSET_RELATIVE_PATH = `${DESKTOP_RUNTIME_ASSETS_DIR}/preview/mermaid.min.js`;

export interface DesktopRuntimeManifest {
  schemaVersion: 1;
  version: string;
  entry: "dist/esm/runtime-launch-entry.mjs";
  webRoot: "dist/web";
}

export interface PrepareDesktopRuntimeOutputDirsInput {
  runtimeDir: string;
  esmDir: string;
  webDir: string;
}

function filterDeployableRuntimeDependencies(
  dependencies: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([, version]) => !version.startsWith("workspace:"))
  );
}

export function createDesktopRuntimeExternalDependencies(
  dependencies: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    DESKTOP_RUNTIME_NATIVE_EXTERNALS.flatMap((nativeDep) => {
      const version = dependencies[nativeDep];
      return version ? [[nativeDep, version]] : [];
    })
  );
}

export async function prepareDesktopRuntimeOutputDirs(
  input: PrepareDesktopRuntimeOutputDirsInput
): Promise<void> {
  await rm(input.runtimeDir, { recursive: true, force: true });
  await mkdir(input.esmDir, { recursive: true });
  await mkdir(input.webDir, { recursive: true });
}

export function createDesktopRuntimeManifest(input: { version: string }): DesktopRuntimeManifest {
  return {
    schemaVersion: 1,
    version: input.version,
    entry: "dist/esm/runtime-launch-entry.mjs",
    webRoot: "dist/web",
  };
}

export function createDesktopRuntimeServerBuildOptions(input: {
  runtimeDir: string;
  external: string[];
}): esbuild.BuildOptions {
  return {
    entryPoints: [resolve(RUNTIME_DIR, "src/runtime-launch-entry.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: resolve(input.runtimeDir, "dist/esm/runtime-launch-entry.mjs"),
    outExtension: { ".js": ".mjs" },
    external: input.external,
    sourcemap: true,
    alias: {
      "@coder-studio/runtime": resolve(RUNTIME_DIR, "src/index.ts"),
      "@coder-studio/server": resolve(SERVER_DIR, "src/index.ts"),
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
      "@coder-studio/core": resolve(CORE_DIR, "src/index.ts"),
      "@coder-studio/providers": resolve(PROVIDERS_DIR, "src/index.ts"),
      "@coder-studio/utils": resolve(UTILS_DIR, "src/index.ts"),
    },
  };
}

export function createDesktopRuntimeWslEntryBuildOptions(input: {
  runtimeDir: string;
  external: string[];
}): esbuild.BuildOptions {
  return {
    entryPoints: [resolve(RUNTIME_DIR, "src/wsl-runtime-entry.ts")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: resolve(input.runtimeDir, "dist/esm/wsl-runtime-entry.mjs"),
    outExtension: { ".js": ".mjs" },
    external: input.external,
    sourcemap: true,
    alias: {
      "@coder-studio/runtime": resolve(RUNTIME_DIR, "src/index.ts"),
      "@coder-studio/server": resolve(SERVER_DIR, "src/index.ts"),
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
      "@coder-studio/core": resolve(CORE_DIR, "src/index.ts"),
      "@coder-studio/providers": resolve(PROVIDERS_DIR, "src/index.ts"),
      "@coder-studio/utils": resolve(UTILS_DIR, "src/index.ts"),
    },
  };
}

export function createDesktopRuntimePackageJson(input: {
  version: string;
}): Record<string, unknown> {
  return {
    name: "@coder-studio/desktop-runtime",
    version: input.version,
    private: true,
    type: "module",
    main: "./dist/esm/runtime-launch-entry.mjs",
    exports: {
      ".": {
        import: "./dist/esm/runtime-launch-entry.mjs",
      },
    },
    files: ["dist", "runtime-manifest.json", "package.json"],
  };
}

async function readRootVersion(): Promise<string> {
  return readDesktopRuntimeVersion({
    rootPackageJsonPath: resolve(DESKTOP_DIR, "..", "..", "package.json"),
    cliPackageJsonPath: resolve(DESKTOP_DIR, "..", "cli", "package.json"),
  });
}

export async function readDesktopRuntimeVersion(input: {
  rootPackageJsonPath: string;
  cliPackageJsonPath: string;
}): Promise<string> {
  const manifests = await Promise.all([
    readFile(input.rootPackageJsonPath, "utf-8").then(
      (raw) => JSON.parse(raw) as { version?: string }
    ),
    readFile(input.cliPackageJsonPath, "utf-8").then(
      (raw) => JSON.parse(raw) as { version?: string }
    ),
  ]);

  for (const manifest of manifests) {
    if (typeof manifest.version === "string" && manifest.version.trim().length > 0) {
      return manifest.version.trim();
    }
  }

  return "0.0.0";
}

function resolveMermaidAssetSourcePath(): string {
  const require = createRequire(import.meta.url);
  const candidates = [
    (() => {
      try {
        return require.resolve("mermaid/dist/mermaid.min.js");
      } catch {
        return null;
      }
    })(),
    resolve(ROOT_DIR, "node_modules", "mermaid", "dist", "mermaid.min.js"),
    resolve(ROOT_DIR, "node_modules", ".pnpm", "node_modules", "mermaid", "dist", "mermaid.min.js"),
  ];

  const resolved = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && existsSync(candidate)
  );
  if (!resolved) {
    throw new Error("Unable to resolve mermaid runtime asset for desktop runtime packaging.");
  }

  return resolved;
}

async function copyDesktopRuntimeStaticAssets(input: { runtimeDir: string }): Promise<void> {
  const targetPath = join(input.runtimeDir, MERMAID_ASSET_RELATIVE_PATH);
  await copy(resolveMermaidAssetSourcePath(), targetPath);
}

export async function buildDesktopRuntimeBundle(input?: {
  runtimeDir?: string;
  runtimeVersion?: string;
  webSourceDir?: string;
  dependencyVersions?: Record<string, string>;
  esbuildBuild?: typeof esbuild.build;
  copyStaticAssets?: (input: { runtimeDir: string }) => Promise<void>;
}): Promise<void> {
  const runtimeDir = input?.runtimeDir ?? resolve(DESKTOP_DIR, "dist/runtime/embedded");
  const runtimeVersion = input?.runtimeVersion ?? (await readRootVersion());
  const esbuildBuild = input?.esbuildBuild ?? esbuild.build;
  const webSourceDir = input?.webSourceDir ?? WEB_DIST_DIR;
  const dependencyVersions = filterDeployableRuntimeDependencies(
    input?.dependencyVersions ??
      (
        JSON.parse(await readFile(resolve(SERVER_DIR, "package.json"), "utf-8")) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies ??
      {}
  );
  const externalDependencies = createDesktopRuntimeExternalDependencies(dependencyVersions);
  const copyStaticAssets = input?.copyStaticAssets ?? copyDesktopRuntimeStaticAssets;

  await prepareDesktopRuntimeOutputDirs({
    runtimeDir,
    esmDir: join(runtimeDir, "dist", "esm"),
    webDir: join(runtimeDir, "dist", "web"),
  });

  await esbuildBuild(
    createDesktopRuntimeServerBuildOptions({
      runtimeDir,
      external: Object.keys(externalDependencies),
    })
  );
  await esbuildBuild(
    createDesktopRuntimeWslEntryBuildOptions({
      runtimeDir,
      external: Object.keys(externalDependencies),
    })
  );
  await copyDir(webSourceDir, join(runtimeDir, "dist", "web"));
  await copyStaticAssets({ runtimeDir });
  await writeFile(
    join(runtimeDir, "runtime-manifest.json"),
    `${JSON.stringify(createDesktopRuntimeManifest({ version: runtimeVersion }), null, 2)}\n`
  );
  await writeFile(
    join(runtimeDir, "package.json"),
    `${JSON.stringify(
      createDesktopRuntimePackageJson({
        version: runtimeVersion,
      }),
      null,
      2
    )}\n`
  );
}

if (isDirectExecution(import.meta.url)) {
  buildDesktopRuntimeBundle()
    .then(() => {
      success(`Desktop embedded runtime built in ${resolve(DESKTOP_DIR, "dist/runtime/embedded")}`);
      log("\n✓ Desktop embedded runtime complete.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
