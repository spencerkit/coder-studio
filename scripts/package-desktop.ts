import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DESKTOP_DIR, error, info, ROOT_DIR, run, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export async function readDesktopReleaseVersion(
  packagePath = resolve(DESKTOP_DIR, "package.json")
): Promise<string> {
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(
      "Unable to resolve the desktop release version from packages/desktop/package.json"
    );
  }
  return manifest.version.trim();
}

export function createDesktopPackageArgs(options: {
  unpacked: boolean;
  outputDirectory?: string;
}): string[] {
  return [
    "exec",
    "electron-builder",
    ...(options.unpacked ? ["--dir"] : []),
    "--config",
    "electron-builder.yml",
    "--publish",
    "never",
    ...(options.outputDirectory
      ? ["--config.directories.output", resolve(options.outputDirectory)]
      : []),
  ];
}

export async function stageDesktopBuildInfo(options: {
  sourcePath: string;
  outputDirectory: string;
}): Promise<void> {
  await mkdir(options.outputDirectory, { recursive: true });
  await copyFile(options.sourcePath, resolve(options.outputDirectory, "build-info.json"));
}

export async function packageDesktop(options: {
  unpacked: boolean;
  outputDirectory?: string;
}): Promise<void> {
  const version = await readDesktopReleaseVersion();
  info(`Packaging Coder Studio desktop ${version}`);
  await run("pnpm", ["exec", "install-electron"], { cwd: DESKTOP_DIR });
  await run(
    "pnpm",
    [...createDesktopPackageArgs(options), "--config.extraMetadata.version", version],
    {
      cwd: DESKTOP_DIR,
    }
  );
  await stageDesktopBuildInfo({
    sourcePath: resolve(DESKTOP_DIR, "dist/build-info.json"),
    outputDirectory: options.outputDirectory ?? resolve(ROOT_DIR, "release/desktop"),
  });
  success(options.unpacked ? "Desktop unpacked directory created" : "Desktop installers created");
}

if (isDirectExecution(import.meta.url)) {
  packageDesktop({ unpacked: process.argv.includes("--dir") }).catch((packageError) => {
    error(packageError instanceof Error ? packageError.message : String(packageError));
    process.exit(1);
  });
}
