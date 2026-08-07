import { createHash } from "node:crypto";
import { access, chmod, cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DESKTOP_NODE_VERSION } from "../packages/desktop/src/runtime-manifest.js";
import { DESKTOP_DIST_DIR } from "./build-desktop.js";
import { ensureDir, error, log, ROOT_DIR, run, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export { DESKTOP_NODE_VERSION } from "../packages/desktop/src/runtime-manifest.js";
export const DESKTOP_ENGINE_DIR = resolve(DESKTOP_DIST_DIR, "engine");

interface RuntimeTarget {
  archiveName: string;
  rootDirName: string;
}

const PORTABLE_NODE_LAUNCHERS = [
  { path: "bin/corepack", target: "lib/node_modules/corepack/dist/corepack.js" },
  { path: "bin/npm", target: "lib/node_modules/npm/bin/npm-cli.js" },
  { path: "bin/npx", target: "lib/node_modules/npm/bin/npx-cli.js" },
] as const;

async function copyEngineTree(source: string, destination: string): Promise<void> {
  await ensureDir(destination);
  await cp(source, destination, { recursive: true, dereference: true, force: true });
}

function resolveRuntimeTarget(platform = process.platform, arch = process.arch): RuntimeTarget {
  const versionPrefix = `node-v${DESKTOP_NODE_VERSION}`;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    const rootDirName = `${versionPrefix}-win-${arch}`;
    return { archiveName: `${rootDirName}.zip`, rootDirName };
  }
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    const rootDirName = `${versionPrefix}-linux-${arch}`;
    return { archiveName: `${rootDirName}.tar.xz`, rootDirName };
  }
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    const rootDirName = `${versionPrefix}-darwin-${arch}`;
    return { archiveName: `${rootDirName}.tar.gz`, rootDirName };
  }
  throw new Error(`Unsupported desktop runtime target: ${platform}-${arch}`);
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function verifyArchive(
  archivePath: string,
  archiveName: string,
  checksums: string
): Promise<void> {
  const expected = checksums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === archiveName)?.[0];
  if (!expected) throw new Error(`No SHA-256 entry found for ${archiveName}`);
  const actual = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${archiveName}`);
}

async function stageNodeRuntime(): Promise<void> {
  const suppliedRuntime = process.env.CODER_STUDIO_DESKTOP_NODE_DIR?.trim();
  if (suppliedRuntime) {
    await copyEngineTree(resolve(suppliedRuntime), DESKTOP_ENGINE_DIR);
    return;
  }

  const target = resolveRuntimeTarget();
  const workDir = await mkdtemp(join(tmpdir(), "coder-studio-node-runtime-"));
  try {
    const baseUrl = `https://nodejs.org/dist/v${DESKTOP_NODE_VERSION}`;
    const archivePath = join(workDir, target.archiveName);
    const checksumsPath = join(workDir, "SHASUMS256.txt");
    await Promise.all([
      download(`${baseUrl}/${target.archiveName}`, archivePath),
      download(`${baseUrl}/SHASUMS256.txt`, checksumsPath),
    ]);
    await verifyArchive(archivePath, target.archiveName, await readFile(checksumsPath, "utf8"));
    await run("tar", ["-xf", archivePath, "-C", workDir]);
    const extractedDir = join(workDir, target.rootDirName);
    await copyEngineTree(extractedDir, DESKTOP_ENGINE_DIR);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Node's POSIX archives expose these commands as symlinks into lib/node_modules. The Engine
 * staging copy intentionally dereferences links so the signed package only contains regular
 * files. Recreate each command as a location-independent JavaScript launcher after the copy;
 * otherwise the dereferenced npm-cli.js resolves ../lib relative to engine/bin and cannot start.
 */
export async function repairPortableNodeLaunchers(
  engineRoot = DESKTOP_ENGINE_DIR,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === "win32") return;

  await Promise.all(
    PORTABLE_NODE_LAUNCHERS.map(async (launcher) => {
      const targetPath = resolve(engineRoot, ...launcher.target.split("/"));
      await access(targetPath);
      const launcherPath = resolve(engineRoot, ...launcher.path.split("/"));
      const relativeTarget = `../${launcher.target}`;
      await writeFile(
        launcherPath,
        [
          "#!/bin/sh",
          'bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
          `exec "$bin_dir/node" "$bin_dir/${relativeTarget}" "$@"`,
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(launcherPath, 0o755);
    })
  );
}

async function stageEngineDependencies(): Promise<void> {
  const deployRoot = await mkdtemp(join(tmpdir(), "coder-studio-engine-deploy-"));
  const deployDir = resolve(deployRoot, "package");
  try {
    await run(
      "pnpm",
      [
        "--config.node-linker=hoisted",
        "--config.inject-workspace-packages=true",
        "--filter",
        "@coder-studio/desktop-engine",
        "deploy",
        "--prod",
        deployDir,
      ],
      { cwd: ROOT_DIR }
    );
    await copyEngineTree(
      resolve(deployDir, "node_modules"),
      resolve(DESKTOP_ENGINE_DIR, "node_modules")
    );
  } finally {
    await rm(deployRoot, { recursive: true, force: true });
  }
}

async function removeEngineSourcemaps(directory = DESKTOP_ENGINE_DIR): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return removeEngineSourcemaps(path);
      if (entry.isFile() && entry.name.endsWith(".map")) await rm(path, { force: true });
    })
  );
}

export async function prepareDesktopPackage(): Promise<void> {
  step("PREPARE DESKTOP", "Staging the desktop Engine and stable dependencies...\n");
  await rm(DESKTOP_ENGINE_DIR, { recursive: true, force: true });
  await ensureDir(DESKTOP_ENGINE_DIR);
  await stageNodeRuntime();
  await repairPortableNodeLaunchers();
  await stageEngineDependencies();
  await removeEngineSourcemaps();
  success(`Desktop Engine prepared with Node ${DESKTOP_NODE_VERSION}`);
}

if (isDirectExecution(import.meta.url)) {
  prepareDesktopPackage()
    .then(() => log("\n✓ Desktop package resources prepared.\n"))
    .catch((prepareError) => {
      error(prepareError instanceof Error ? prepareError.message : String(prepareError));
      process.exit(1);
    });
}
