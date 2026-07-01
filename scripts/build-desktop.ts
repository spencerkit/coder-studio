import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as esbuild from "esbuild";
import { buildDesktopRuntimeBundle } from "./build-desktop-runtime.js";
import {
  CORE_DIR,
  DESKTOP_DIR,
  DESKTOP_DIST_DIR,
  DESKTOP_ELECTRON_DIR,
  DESKTOP_RUNTIME_DIR,
  error,
  info,
  log,
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

export function resolveDesktopReleaseDir(desktopDistDir: string = DESKTOP_DIST_DIR): string {
  return join(desktopDistDir, "release");
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
  input: { exec?: typeof run; desktopDir?: string; outputDir?: string } = {}
): Promise<void> {
  const exec = input.exec ?? run;
  const desktopDir = input.desktopDir ?? DESKTOP_DIR;
  const args = ["exec", "electron-builder", "--projectDir", desktopDir];

  if (input.outputDir) {
    args.push(`--config.directories.output=${input.outputDir}`);
  }

  await exec("pnpm", args, {
    cwd: desktopDir,
  });
}

export async function createDesktopPackageStageDir(
  desktopDir: string = DESKTOP_DIR
): Promise<string> {
  const stageRootDir = join(desktopDir, ".tmp");
  await mkdir(stageRootDir, { recursive: true });
  return mkdtemp(join(stageRootDir, "release-"));
}

export async function materializeDesktopReleaseDir(input: {
  stagedReleaseDir: string;
  releaseDir: string;
}): Promise<void> {
  await rm(input.releaseDir, { recursive: true, force: true });
  await mkdir(dirname(input.releaseDir), { recursive: true });
  await cp(input.stagedReleaseDir, input.releaseDir, { recursive: true, force: true });
}

export async function packageDesktopInstallers(
  input: {
    exec?: typeof run;
    desktopDir?: string;
    desktopDistDir?: string;
    createStageDir?: () => Promise<string>;
    materializeReleaseDir?: (input: {
      stagedReleaseDir: string;
      releaseDir: string;
    }) => Promise<void>;
    removeDir?: typeof rm;
  } = {}
): Promise<string> {
  const exec = input.exec ?? run;
  const desktopDir = input.desktopDir ?? DESKTOP_DIR;
  const desktopDistDir = input.desktopDistDir ?? DESKTOP_DIST_DIR;
  const createStageDir = input.createStageDir ?? (() => createDesktopPackageStageDir(desktopDir));
  const materializeReleaseDir = input.materializeReleaseDir ?? materializeDesktopReleaseDir;
  const removeDir = input.removeDir ?? rm;
  const releaseDir = resolveDesktopReleaseDir(desktopDistDir);
  const stagedReleaseDir = await createStageDir();

  try {
    await buildDesktopPackage({
      exec,
      desktopDir,
      outputDir: stagedReleaseDir,
    });
    await materializeReleaseDir({
      stagedReleaseDir,
      releaseDir,
    });
    return releaseDir;
  } finally {
    await removeDir(stagedReleaseDir, { recursive: true, force: true });
  }
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

  await buildDesktopRuntimeBundle({
    runtimeDir: join(DESKTOP_RUNTIME_DIR, "embedded"),
  });
  await mkdir(join(DESKTOP_RUNTIME_DIR, "node"), { recursive: true });
  await cp(process.execPath, join(DESKTOP_RUNTIME_DIR, "node", resolveEmbeddedNodeOutputName()), {
    force: true,
  });

  if (shouldPackageDesktop()) {
    const releaseDir = await packageDesktopInstallers();
    success(`Desktop installers built in ${releaseDir}`);
  } else {
    info(
      "Desktop embedded runtime assembled. Installer packaging is skipped on this host platform."
    );
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
