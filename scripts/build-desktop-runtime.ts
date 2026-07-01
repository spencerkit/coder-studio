import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import {
  CORE_DIR,
  copyDir,
  DESKTOP_DIR,
  error,
  log,
  PROVIDERS_DIR,
  ROOT_DIR,
  RUNTIME_DIR,
  run,
  SERVER_DIR,
  success,
  UTILS_DIR,
  WEB_DIST_DIR,
} from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export interface DesktopRuntimeManifest {
  schemaVersion: 1;
  version: string;
  entry: "dist/esm/runtime-launch-entry.mjs";
  webRoot: "dist/web";
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

export function createDesktopRuntimePackageJson(input: {
  version: string;
  dependencies: Record<string, string>;
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
    dependencies: filterDeployableRuntimeDependencies(input.dependencies),
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

async function readRootPackageManager(): Promise<string | null> {
  const rootPackageJson = JSON.parse(
    await readFile(resolve(ROOT_DIR, "package.json"), "utf-8")
  ) as { packageManager?: string };
  return typeof rootPackageJson.packageManager === "string" && rootPackageJson.packageManager.trim()
    ? rootPackageJson.packageManager.trim()
    : null;
}

async function createDesktopRuntimeWorkspace(input: {
  tempWorkspaceDir: string;
  runtimeVersion: string;
  dependencyVersions: Record<string, string>;
  esbuildBuild: typeof esbuild.build;
  webSourceDir: string;
}): Promise<string> {
  const runtimePackageDir = join(input.tempWorkspaceDir, "packages", "runtime");
  const runtimeDistDir = join(runtimePackageDir, "dist");
  const runtimeEsmDir = join(runtimeDistDir, "esm");
  const runtimeWebDir = join(runtimeDistDir, "web");
  const packageManager = await readRootPackageManager();

  await rm(input.tempWorkspaceDir, { recursive: true, force: true });
  await mkdir(runtimeEsmDir, { recursive: true });
  await mkdir(runtimeWebDir, { recursive: true });

  await writeFile(
    join(input.tempWorkspaceDir, "package.json"),
    `${JSON.stringify(
      {
        name: "coder-studio-desktop-runtime-workspace",
        private: true,
        ...(packageManager ? { packageManager } : {}),
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(input.tempWorkspaceDir, "pnpm-workspace.yaml"),
    "packages:\n  - packages/runtime\n"
  );
  await cp(join(ROOT_DIR, "pnpm-lock.yaml"), join(input.tempWorkspaceDir, "pnpm-lock.yaml"), {
    force: true,
  });

  await input.esbuildBuild(
    createDesktopRuntimeServerBuildOptions({
      runtimeDir: runtimePackageDir,
      external: Object.keys(input.dependencyVersions),
    })
  );
  await input.esbuildBuild(
    createDesktopRuntimeWslEntryBuildOptions({
      runtimeDir: runtimePackageDir,
      external: Object.keys(input.dependencyVersions),
    })
  );
  await copyDir(input.webSourceDir, runtimeWebDir);
  await writeFile(
    join(runtimePackageDir, "runtime-manifest.json"),
    `${JSON.stringify(createDesktopRuntimeManifest({ version: input.runtimeVersion }), null, 2)}\n`
  );
  await writeFile(
    join(runtimePackageDir, "package.json"),
    `${JSON.stringify(
      createDesktopRuntimePackageJson({
        version: input.runtimeVersion,
        dependencies: input.dependencyVersions,
      }),
      null,
      2
    )}\n`
  );

  return runtimePackageDir;
}

function createDeployArgs(input: { runtimeDir: string; offline: boolean }): string[] {
  return [
    "--filter",
    "@coder-studio/desktop-runtime",
    "deploy",
    "--legacy",
    "--prod",
    ...(input.offline ? ["--offline"] : []),
    input.runtimeDir,
  ];
}

function isOfflineMetadataError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("ERR_PNPM_NO_OFFLINE_META");
}

async function deployDesktopRuntimeBundle(input: {
  exec: typeof run;
  runtimeDir: string;
  tempWorkspaceDir: string;
}): Promise<void> {
  try {
    await input.exec("pnpm", createDeployArgs({ runtimeDir: input.runtimeDir, offline: true }), {
      cwd: input.tempWorkspaceDir,
      stdio: "pipe",
    });
  } catch (error) {
    if (!isOfflineMetadataError(error)) {
      throw error;
    }

    await rm(input.runtimeDir, { recursive: true, force: true });
    await input.exec("pnpm", createDeployArgs({ runtimeDir: input.runtimeDir, offline: false }), {
      cwd: input.tempWorkspaceDir,
    });
  }
}

export async function buildDesktopRuntimeBundle(input?: {
  runtimeDir?: string;
  runtimeVersion?: string;
  webSourceDir?: string;
  dependencyVersions?: Record<string, string>;
  esbuildBuild?: typeof esbuild.build;
  exec?: typeof run;
  tempWorkspaceDir?: string;
}): Promise<void> {
  const runtimeDir = input?.runtimeDir ?? resolve(DESKTOP_DIR, "dist/runtime/embedded");
  const runtimeVersion = input?.runtimeVersion ?? (await readRootVersion());
  const esbuildBuild = input?.esbuildBuild ?? esbuild.build;
  const webSourceDir = input?.webSourceDir ?? WEB_DIST_DIR;
  const exec = input?.exec ?? run;
  const dependencyVersions = filterDeployableRuntimeDependencies(
    input?.dependencyVersions ?? {
      ...((
        JSON.parse(await readFile(resolve(SERVER_DIR, "package.json"), "utf-8")) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies ?? {}),
    }
  );
  const tempWorkspaceDir =
    input?.tempWorkspaceDir ?? resolve(DESKTOP_DIR, "dist/.desktop-runtime-workspace");

  await rm(runtimeDir, { recursive: true, force: true });

  await createDesktopRuntimeWorkspace({
    tempWorkspaceDir,
    runtimeVersion,
    dependencyVersions,
    esbuildBuild,
    webSourceDir,
  });

  try {
    await deployDesktopRuntimeBundle({
      exec,
      runtimeDir,
      tempWorkspaceDir,
    });
    await materializePortableRuntimeDir(runtimeDir);
  } finally {
    await rm(tempWorkspaceDir, { recursive: true, force: true });
  }
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

export async function materializePortableRuntimeDir(runtimeDir: string): Promise<void> {
  const materializedDir = `${runtimeDir}.materialized`;
  await rm(materializedDir, { recursive: true, force: true });
  await cp(runtimeDir, materializedDir, {
    recursive: true,
    force: true,
    dereference: true,
  });
  await rm(runtimeDir, { recursive: true, force: true });
  await rename(materializedDir, runtimeDir);
}
