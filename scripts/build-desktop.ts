import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import {
  CLI_DIR,
  CORE_DIR,
  DESKTOP_DIR,
  DESKTOP_DIST_DIR,
  DESKTOP_ELECTRON_DIR,
  DESKTOP_RUNTIME_DIR,
  error,
  info,
  log,
  ROOT_DIR,
  run,
  step,
  success,
} from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export function resolveEmbeddedNodeOutputName(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32" ? "node.exe" : "node";
}

export function shouldPackageDesktop(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export async function prepareDesktopOutputDirs(input: {
  desktopDistDir: string;
  electronDir: string;
  runtimeDir: string;
}): Promise<void> {
  await rm(input.desktopDistDir, { recursive: true, force: true });
  await mkdir(input.electronDir, { recursive: true });
  await mkdir(input.runtimeDir, { recursive: true });
}

export async function buildDesktopPackage(
  input: { exec?: typeof run; desktopDir?: string } = {}
): Promise<void> {
  const exec = input.exec ?? run;
  const desktopDir = input.desktopDir ?? DESKTOP_DIR;

  await exec(
    "pnpm",
    ["exec", "electron-builder", "--projectDir", desktopDir, "--publish", "never"],
    { cwd: desktopDir }
  );
}

export async function stageCliRuntimeBundle(
  input: {
    exec?: typeof run;
    rootDir?: string;
    cliDir?: string;
    runtimeCliDir?: string;
    tempWorkspaceDir?: string;
  } = {}
): Promise<void> {
  const exec = input.exec ?? run;
  const rootDir = input.rootDir ?? ROOT_DIR;
  const cliDir = input.cliDir ?? CLI_DIR;
  const runtimeCliDir = input.runtimeCliDir ?? join(DESKTOP_RUNTIME_DIR, "cli");
  const tempWorkspaceDir =
    input.tempWorkspaceDir ?? join(DESKTOP_RUNTIME_DIR, ".desktop-runtime-workspace");

  await prepareDesktopDeployWorkspace({
    rootDir,
    cliDir,
    tempWorkspaceDir,
  });

  try {
    await exec(
      "pnpm",
      [
        "--filter",
        "@spencer-kit/coder-studio",
        "deploy",
        "--legacy",
        "--prod",
        "--offline",
        runtimeCliDir,
      ],
      {
        cwd: tempWorkspaceDir,
      }
    );
  } finally {
    await rm(tempWorkspaceDir, { recursive: true, force: true });
  }
}

interface DesktopDeployWorkspaceInput {
  rootDir: string;
  cliDir: string;
  tempWorkspaceDir: string;
}

interface DesktopRuntimePackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  description?: string;
  main?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  keywords?: string[];
  author?: string;
  license?: string;
  repository?: unknown;
  bugs?: unknown;
  homepage?: string;
}

async function createDesktopDeployRootPackage(rootDir: string): Promise<Record<string, unknown>> {
  const rootPackageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf-8")) as {
    packageManager?: string;
  };

  return {
    name: "coder-studio-desktop-runtime-workspace",
    private: true,
    ...(rootPackageJson.packageManager ? { packageManager: rootPackageJson.packageManager } : {}),
  };
}

async function createDesktopDeployCliPackage(cliDir: string): Promise<DesktopRuntimePackageJson> {
  const cliPackageJson = JSON.parse(
    await readFile(join(cliDir, "package.json"), "utf-8")
  ) as DesktopRuntimePackageJson;

  return {
    ...(cliPackageJson.name ? { name: cliPackageJson.name } : {}),
    ...(cliPackageJson.version ? { version: cliPackageJson.version } : {}),
    ...(cliPackageJson.private !== undefined ? { private: cliPackageJson.private } : {}),
    ...(cliPackageJson.type ? { type: cliPackageJson.type } : {}),
    ...(cliPackageJson.description ? { description: cliPackageJson.description } : {}),
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
    ...(cliPackageJson.dependencies ? { dependencies: cliPackageJson.dependencies } : {}),
    ...(cliPackageJson.engines ? { engines: cliPackageJson.engines } : {}),
    ...(cliPackageJson.keywords ? { keywords: cliPackageJson.keywords } : {}),
    ...(cliPackageJson.author ? { author: cliPackageJson.author } : {}),
    ...(cliPackageJson.license ? { license: cliPackageJson.license } : {}),
    ...(cliPackageJson.repository ? { repository: cliPackageJson.repository } : {}),
    ...(cliPackageJson.bugs ? { bugs: cliPackageJson.bugs } : {}),
    ...(cliPackageJson.homepage ? { homepage: cliPackageJson.homepage } : {}),
  };
}

export async function prepareDesktopDeployWorkspace(
  input: DesktopDeployWorkspaceInput
): Promise<void> {
  await rm(input.tempWorkspaceDir, { recursive: true, force: true });
  await mkdir(join(input.tempWorkspaceDir, "packages", "cli"), { recursive: true });

  await writeFile(
    join(input.tempWorkspaceDir, "package.json"),
    `${JSON.stringify(await createDesktopDeployRootPackage(input.rootDir), null, 2)}\n`
  );
  await writeFile(
    join(input.tempWorkspaceDir, "pnpm-workspace.yaml"),
    "packages:\n  - packages/cli\n"
  );
  await cp(join(input.rootDir, "pnpm-lock.yaml"), join(input.tempWorkspaceDir, "pnpm-lock.yaml"), {
    force: true,
  });
  await writeFile(
    join(input.tempWorkspaceDir, "packages", "cli", "package.json"),
    `${JSON.stringify(await createDesktopDeployCliPackage(input.cliDir), null, 2)}\n`
  );
  await cp(join(input.cliDir, "dist"), join(input.tempWorkspaceDir, "packages", "cli", "dist"), {
    recursive: true,
    force: true,
  });
}

export function createDesktopBuildOptions(): esbuild.BuildOptions {
  return {
    entryPoints: {
      main: resolve(DESKTOP_DIR, "src/main.ts"),
      preload: resolve(DESKTOP_DIR, "src/preload.ts"),
    },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outdir: DESKTOP_ELECTRON_DIR,
    outExtension: { ".js": ".mjs" },
    external: ["electron"],
    sourcemap: true,
    alias: {
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
    },
  };
}

export async function buildDesktop(): Promise<void> {
  step("BUILD DESKTOP", "Bundling Electron shell and packaging installers...\n");

  await prepareDesktopOutputDirs({
    desktopDistDir: DESKTOP_DIST_DIR,
    electronDir: DESKTOP_ELECTRON_DIR,
    runtimeDir: DESKTOP_RUNTIME_DIR,
  });

  await esbuild.build(createDesktopBuildOptions());

  await stageCliRuntimeBundle();
  await mkdir(join(DESKTOP_RUNTIME_DIR, "node"), { recursive: true });
  await cp(process.execPath, join(DESKTOP_RUNTIME_DIR, "node", resolveEmbeddedNodeOutputName()), {
    force: true,
  });

  if (shouldPackageDesktop()) {
    await buildDesktopPackage();
    success(`Desktop installers built in ${join(DESKTOP_DIST_DIR, "release")}`);
  } else {
    info("Desktop runtime bundle assembled. Installer packaging is skipped on this host platform.");
  }
}

if (isDirectExecution(import.meta.url)) {
  buildDesktop()
    .then(() => {
      log("\n✓ Desktop build complete.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
