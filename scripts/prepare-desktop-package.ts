import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep, win32 } from "node:path";
import {
  type FactoryProductProvenance,
  type ProductRuntimeTarget,
  parseFactoryProductProvenance,
} from "../packages/desktop/src/product-channel.js";
import {
  DESKTOP_NODE_VERSION,
  hashRuntimeFile,
  parseInstalledRuntimeManifest,
  resolveRuntimeFile,
} from "../packages/desktop/src/runtime-manifest.js";
import { DESKTOP_DIST_DIR } from "./build-desktop.js";
import { ensureDir, error, log, ROOT_DIR, run, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export { DESKTOP_NODE_VERSION } from "../packages/desktop/src/runtime-manifest.js";
export const DESKTOP_ENGINE_DIR = resolve(DESKTOP_DIST_DIR, "engine");
export const DESKTOP_FACTORY_RUNTIME_DIR = resolve(DESKTOP_DIST_DIR, "factory-runtime");
export const DESKTOP_FACTORY_PRODUCT_PATH = resolve(DESKTOP_DIST_DIR, "factory-product.json");

interface RuntimeTarget {
  archiveName: string;
  rootDirName: string;
}

interface TarExecution {
  cwd: string;
  args: string[];
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

function toTarRelativePath(root: string, target: string, label: string): string {
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(root) || /^[A-Za-z]:[\\/]/.test(target);
  const path = isWindowsPath ? win32.relative(root, target) : relative(root, target);
  const parentPrefix = `..${isWindowsPath ? win32.sep : sep}`;
  if (!path || path === "." || path === ".." || path.startsWith(parentPrefix)) {
    throw new Error(`${label} must stay inside ${root}`);
  }
  return path.replaceAll("\\", "/");
}

export function createNodeRuntimeExtractionExecution(
  archivePath: string,
  cwd: string
): TarExecution {
  return {
    cwd,
    args: ["-xf", toTarRelativePath(cwd, archivePath, "Desktop Node archive"), "-C", "."],
  };
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
    const extraction = createNodeRuntimeExtractionExecution(archivePath, workDir);
    await run("tar", extraction.args, { cwd: extraction.cwd });
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

async function collectRegularFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Factory Runtime contains an unsupported symbolic link: ${entry.name}`);
    }
    if (metadata.isDirectory()) files.push(...(await collectRegularFiles(root, path)));
    else if (metadata.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Factory Runtime contains an unsupported filesystem entry: ${entry.name}`);
  }
  return files.sort();
}

export async function stageAcceptedFactoryRuntime(options: {
  sourceRuntimeDir: string;
  sourceProvenanceFile: string;
  runtimeDestination?: string;
  provenanceDestination?: string;
  target?: ProductRuntimeTarget;
}): Promise<FactoryProductProvenance> {
  const sourceRuntimeDir = resolve(options.sourceRuntimeDir);
  const sourceProvenanceFile = resolve(options.sourceProvenanceFile);
  const runtimeDestination = resolve(options.runtimeDestination ?? DESKTOP_FACTORY_RUNTIME_DIR);
  const provenanceDestination = resolve(
    options.provenanceDestination ?? DESKTOP_FACTORY_PRODUCT_PATH
  );
  if (sourceRuntimeDir === runtimeDestination) {
    throw new Error("Factory Runtime source must be an independently resolved directory");
  }
  const target = options.target ?? `${process.platform}-${process.arch}`;
  if (target !== "win32-x64" && target !== "linux-x64") {
    throw new Error(`Unsupported Factory Runtime target: ${target}`);
  }
  const provenance = parseFactoryProductProvenance(
    JSON.parse(await readFile(sourceProvenanceFile, "utf8"))
  );
  const manifestPath = resolve(sourceRuntimeDir, "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const expected = provenance.runtimes[target];
  const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
  if (manifestDigest !== expected.manifestSha256) {
    throw new Error("Factory Runtime manifest digest does not match accepted Product provenance");
  }
  const manifest = parseInstalledRuntimeManifest(JSON.parse(manifestBytes.toString("utf8")));
  const [platform, arch] = target.split("-");
  if (
    manifest.runtimeVersion !== provenance.version ||
    manifest.platform !== platform ||
    manifest.arch !== arch
  ) {
    throw new Error("Factory Runtime manifest does not match accepted Product identity");
  }
  const actualFiles = (await collectRegularFiles(sourceRuntimeDir)).filter(
    (path) => path !== "manifest.json"
  );
  const expectedFiles = manifest.files.map((file) => file.path).sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index])
  ) {
    throw new Error("Factory Runtime file set does not match its manifest");
  }
  for (const file of manifest.files) {
    const actual = await hashRuntimeFile(resolveRuntimeFile(sourceRuntimeDir, file.path));
    if (actual.sha256 !== file.sha256 || actual.size !== file.size) {
      throw new Error(`Factory Runtime file verification failed: ${file.path}`);
    }
  }

  await rm(runtimeDestination, { recursive: true, force: true });
  await ensureDir(resolve(provenanceDestination, ".."));
  await cp(sourceRuntimeDir, runtimeDestination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(provenanceDestination, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  return provenance;
}

export async function prepareDesktopPackage(
  options: { includeFactoryRuntime?: boolean } = {}
): Promise<void> {
  step("PREPARE DESKTOP", "Staging the desktop Engine and stable dependencies...\n");
  await rm(DESKTOP_ENGINE_DIR, { recursive: true, force: true });
  await ensureDir(DESKTOP_ENGINE_DIR);
  await stageNodeRuntime();
  await repairPortableNodeLaunchers();
  await stageEngineDependencies();
  await removeEngineSourcemaps();
  if (options.includeFactoryRuntime !== false) {
    const sourceRuntimeDir = process.env.CODER_STUDIO_FACTORY_RUNTIME_DIR?.trim();
    const sourceProvenanceFile = process.env.CODER_STUDIO_FACTORY_PRODUCT_FILE?.trim();
    if (!sourceRuntimeDir || !sourceProvenanceFile) {
      throw new Error(
        "Desktop packaging requires CODER_STUDIO_FACTORY_RUNTIME_DIR and CODER_STUDIO_FACTORY_PRODUCT_FILE"
      );
    }
    await stageAcceptedFactoryRuntime({ sourceRuntimeDir, sourceProvenanceFile });
  }
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
