import { createPrivateKey, sign } from "node:crypto";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { writeJsonFileAtomic } from "../packages/desktop/src/atomic-json-file.js";
import {
  normalizeUtcTimestamp,
  parseDesktopBuildInfo,
} from "../packages/desktop/src/build-info.js";
import type { DesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import { parseNetworkRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { parseUpdaterMetadata } from "./desktop-release-artifacts.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export interface BuildDesktopChannelOptions {
  directory: string;
  releaseTag: string;
  channel: "stable" | "prerelease";
  generatedAt: string;
  privateKeyPem: string;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

async function assertReleaseDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Desktop release directory must not be a symbolic link: ${directory}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Desktop release path must be a directory: ${directory}`);
  }
}

async function readRegularFile(root: string, filename: string): Promise<Buffer> {
  if (filename !== basename(filename) || filename === "." || filename === "..") {
    throw new Error(`Desktop channel asset path is unsafe: ${filename}`);
  }
  const normalizedRoot = resolve(root);
  const path = resolve(normalizedRoot, filename);
  if (!isInside(normalizedRoot, path)) {
    throw new Error(`Desktop channel asset escaped the release directory: ${filename}`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Desktop channel asset must be a regular file: ${filename}`);
  }
  return readFile(path);
}

async function readJson(root: string, filename: string): Promise<unknown> {
  return JSON.parse((await readRegularFile(root, filename)).toString("utf8"));
}

function assertRuntimePair(
  windows: ReturnType<typeof parseNetworkRuntimeManifest>,
  linux: ReturnType<typeof parseNetworkRuntimeManifest>
): void {
  const sharedFields = [
    "runtimeVersion",
    "publishedAt",
    "minShellVersion",
    "requiredEngineVersion",
    "requiredNodeVersion",
    "runtimeHostApiVersion",
    "apiProtocolVersion",
    "dataSchemaVersion",
  ] as const;
  if (sharedFields.some((field) => windows[field] !== linux[field])) {
    throw new Error("Windows and WSL Runtime metadata must describe one product release");
  }
  if (windows.platform !== "win32" || linux.platform !== "linux") {
    throw new Error("Windows and WSL Runtime manifests use the wrong platform");
  }
  if (windows.arch !== "x64" || linux.arch !== "x64") {
    throw new Error("Windows and WSL Runtime manifests must target x64");
  }
}

export async function buildDesktopChannel(
  options: BuildDesktopChannelOptions
): Promise<DesktopChannel> {
  const directory = resolve(options.directory);
  await assertReleaseDirectory(directory);
  const buildInfo = parseDesktopBuildInfo(await readJson(directory, "build-info.json"));
  if (
    !buildInfo.publishedAt ||
    !buildInfo.engineVersion ||
    !buildInfo.nodeVersion ||
    !buildInfo.runtimeHostApiVersion ||
    !buildInfo.apiProtocolVersion ||
    !buildInfo.dataSchemaVersion
  ) {
    throw new Error("Packaged Shell build info is incomplete");
  }
  const updater = parseUpdaterMetadata(
    (await readRegularFile(directory, "latest.yml")).toString("utf8")
  );
  if (updater.version !== buildInfo.shellVersion) {
    throw new Error("Electron updater metadata does not match Shell build info");
  }
  const windows = parseNetworkRuntimeManifest(
    await readJson(directory, "coder-studio-runtime-win32-x64.manifest.json")
  );
  const linux = parseNetworkRuntimeManifest(
    await readJson(directory, "coder-studio-server-runtime-linux-x64.manifest.json")
  );
  assertRuntimePair(windows, linux);
  const releaseTag = options.releaseTag.trim();
  if (!releaseTag || /[\u0000-\u001f/\\]/.test(releaseTag)) {
    throw new Error("Desktop release tag is invalid");
  }
  const unsigned: Omit<DesktopChannel, "signature"> = {
    schemaVersion: 1,
    channel: options.channel,
    releaseTag,
    generatedAt: normalizeUtcTimestamp(options.generatedAt, "generatedAt"),
    shell: {
      version: buildInfo.shellVersion,
      publishedAt: buildInfo.publishedAt,
      updaterMetadata: "latest.yml",
      engineVersion: buildInfo.engineVersion,
      nodeVersion: buildInfo.nodeVersion,
      runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
      apiProtocolVersion: buildInfo.apiProtocolVersion,
      dataSchemaVersion: buildInfo.dataSchemaVersion,
    },
    runtimes: {
      "win32-x64": {
        version: windows.runtimeVersion,
        publishedAt: windows.publishedAt,
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
      },
      "linux-x64": {
        version: linux.runtimeVersion,
        publishedAt: linux.publishedAt,
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
      },
    },
  };
  const signature = sign(
    null,
    canonicalSigningPayload(unsigned),
    createPrivateKey(options.privateKeyPem)
  ).toString("base64");
  const channel: DesktopChannel = {
    ...unsigned,
    signature: { algorithm: "ed25519", value: signature },
  };
  await writeJsonFileAtomic(resolve(directory, "desktop-channel.json"), channel);
  return channel;
}

export async function carryForwardDesktopBase(
  previousReleaseDirectory: string,
  destinationDirectory: string
): Promise<string[]> {
  const previous = resolve(previousReleaseDirectory);
  const destination = resolve(destinationDirectory);
  if (previous === destination) {
    throw new Error("Previous and destination release directories must differ");
  }
  await assertReleaseDirectory(previous);
  const updater = parseUpdaterMetadata(
    (await readRegularFile(previous, "latest.yml")).toString("utf8")
  );
  const engineManifest = (await readJson(
    previous,
    "coder-studio-engine-linux-x64.manifest.json"
  )) as { packageFile?: unknown };
  if (
    typeof engineManifest.packageFile !== "string" ||
    engineManifest.packageFile !== basename(engineManifest.packageFile)
  ) {
    throw new Error("Previous Engine manifest has an invalid packageFile");
  }
  const filenames = [
    updater.path,
    `${updater.path}.blockmap`,
    "build-info.json",
    engineManifest.packageFile,
    "coder-studio-engine-linux-x64.manifest.json",
    "desktop-channel.json",
    "latest.yml",
  ].sort();
  await mkdir(destination, { recursive: true });
  await assertReleaseDirectory(destination);
  for (const filename of filenames) {
    await readRegularFile(previous, filename);
    const destinationPath = resolve(destination, filename);
    try {
      const metadata = await lstat(destinationPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Carry-forward destination must not be a symbolic link: ${filename}`);
      }
    } catch (destinationError) {
      if ((destinationError as NodeJS.ErrnoException).code !== "ENOENT") throw destinationError;
    }
    await copyFile(resolve(previous, filename), destinationPath);
  }
  return filenames;
}

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function normalizeDesktopChannelArgs(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

async function main(): Promise<void> {
  const argv = normalizeDesktopChannelArgs(process.argv.slice(2));
  let directory = "";
  let releaseTag = "";
  let channel: "stable" | "prerelease" | null = null;
  let generatedAt = "";
  let privateKeyPath = "";
  let carryForwardFrom = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--directory") directory = readArgumentValue(argv, ++index, argument);
    else if (argument === "--release-tag") releaseTag = readArgumentValue(argv, ++index, argument);
    else if (argument === "--generated-at")
      generatedAt = readArgumentValue(argv, ++index, argument);
    else if (argument === "--private-key")
      privateKeyPath = readArgumentValue(argv, ++index, argument);
    else if (argument === "--carry-forward-from") {
      carryForwardFrom = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--channel") {
      const value = readArgumentValue(argv, ++index, argument);
      if (value !== "stable" && value !== "prerelease") throw new Error("Invalid --channel");
      channel = value;
    } else throw new Error(`Unknown Desktop channel option: ${argument}`);
  }
  if (carryForwardFrom) {
    if (!directory || releaseTag || channel || generatedAt || privateKeyPath) {
      throw new Error("Carry-forward requires only --directory and --carry-forward-from");
    }
    await carryForwardDesktopBase(carryForwardFrom, directory);
    success(`Immutable Desktop base carried forward to ${resolve(directory)}`);
    return;
  }
  if (!directory || !releaseTag || !channel || !generatedAt || !privateKeyPath) {
    throw new Error(
      "--directory, --release-tag, --channel, --generated-at, and --private-key are required"
    );
  }
  await buildDesktopChannel({
    directory,
    releaseTag,
    channel,
    generatedAt,
    privateKeyPem: await readFile(resolve(privateKeyPath), "utf8"),
  });
  success(`Signed Desktop channel written to ${resolve(directory, "desktop-channel.json")}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((channelError) => {
    error(channelError instanceof Error ? channelError.message : String(channelError));
    process.exit(1);
  });
}
