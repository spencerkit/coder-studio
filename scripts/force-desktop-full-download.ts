import { lstat, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse } from "yaml";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

interface UpdaterMetadata {
  path: string;
  version: string;
}

interface BlockMap {
  version: string;
  [key: string]: unknown;
}

export interface ForceFullDownloadResult {
  blockmapPath: string;
  originalVersion: string;
  forcedVersion: string;
  changed: boolean;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`);
}

async function readRegularFile(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Desktop updater asset must be a regular file: ${path}`);
  }
  return readFile(path);
}

async function readUpdaterMetadata(directory: string): Promise<UpdaterMetadata> {
  const value = parse((await readRegularFile(resolve(directory, "latest.yml"))).toString("utf8"));
  if (!value || typeof value !== "object") {
    throw new Error("Desktop updater metadata must be an object");
  }
  const candidate = value as Record<string, unknown>;
  return {
    path: readRequiredString(candidate.path, "Desktop updater path"),
    version: readRequiredString(candidate.version, "Desktop updater version"),
  };
}

export async function forceDesktopFullDownload(
  directoryValue: string
): Promise<ForceFullDownloadResult> {
  const directory = resolve(directoryValue);
  const updater = await readUpdaterMetadata(directory);
  const blockmapPath = resolve(directory, `${updater.path}.blockmap`);
  if (!isInside(directory, blockmapPath)) {
    throw new Error("Desktop updater blockmap must stay inside the release directory");
  }

  const source = await readRegularFile(blockmapPath);
  let blockmap: BlockMap;
  try {
    const value = JSON.parse(gunzipSync(source).toString("utf8")) as unknown;
    if (!value || typeof value !== "object") throw new Error("blockmap must be an object");
    blockmap = value as BlockMap;
  } catch (blockmapError) {
    throw new Error(
      `Cannot parse Desktop updater blockmap: ${blockmapError instanceof Error ? blockmapError.message : String(blockmapError)}`
    );
  }

  const originalVersion = readRequiredString(blockmap.version, "Desktop blockmap version");
  // The installed 0.1.1 Shell controls its own upgrade and cannot observe the new
  // disableDifferentialDownload setting yet. A valid-but-incompatible blockmap version makes
  // electron-updater take its existing full-download fallback, which still verifies latest.yml's
  // installer SHA-512. New Shells disable differential downloads before checking for updates.
  const marker = `coder-studio-full-download-${updater.version}`;
  const forcedVersion = originalVersion.includes("-coder-studio-full-download-")
    ? originalVersion
    : `${originalVersion}-${marker}`;
  if (forcedVersion !== `${originalVersion.split("-coder-studio-full-download-")[0]}-${marker}`) {
    throw new Error("Desktop blockmap is already marked for a different full-download release");
  }
  if (blockmap.version === forcedVersion) {
    return { blockmapPath, originalVersion, forcedVersion, changed: false };
  }

  blockmap.version = forcedVersion;
  await writeFile(blockmapPath, gzipSync(JSON.stringify(blockmap)));
  return { blockmapPath, originalVersion, forcedVersion, changed: true };
}

function parseDirectory(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--directory" || !argv[1]) {
    throw new Error("Usage: force-desktop-full-download --directory <release-directory>");
  }
  return argv[1];
}

async function main(): Promise<void> {
  const result = await forceDesktopFullDownload(parseDirectory(process.argv.slice(2)));
  success(
    `${result.changed ? "Marked" : "Verified"} Desktop blockmap for full installer download: ${result.blockmapPath}`
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((forceError) => {
    error(
      forceError instanceof Error ? forceError.stack || forceError.message : String(forceError)
    );
    process.exit(1);
  });
}
