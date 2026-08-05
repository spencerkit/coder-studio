import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DESKTOP_DIST_DIR } from "./build-desktop.js";
import { copyDir, ensureDir, error, log, ROOT_DIR, run, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export const DESKTOP_NODE_VERSION = "24.19.0";
export const DESKTOP_ENGINE_DIR = resolve(DESKTOP_DIST_DIR, "engine");

interface RuntimeTarget {
  archiveName: string;
  rootDirName: string;
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
    await copyDir(resolve(suppliedRuntime), DESKTOP_ENGINE_DIR);
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
    await copyDir(extractedDir, DESKTOP_ENGINE_DIR);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
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
    await copyDir(resolve(deployDir, "node_modules"), resolve(DESKTOP_ENGINE_DIR, "node_modules"));
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
