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
  buildInfoFile?: string;
  updaterMetadataFile?: DesktopChannel["shell"]["updaterMetadata"];
  windowsRuntimeManifestFile?: string;
  linuxRuntimeManifestFile?: string;
  outputFile?: string;
}

export const MODERN_WINDOWS_RUNTIME_MANIFEST =
  "coder-studio-runtime-modern-win32-x64.manifest.json";
export const MODERN_LINUX_RUNTIME_MANIFEST =
  "coder-studio-server-runtime-modern-linux-x64.manifest.json";

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
  const buildInfoFile = options.buildInfoFile ?? "build-info.json";
  const updaterMetadataFile = options.updaterMetadataFile ?? "latest.yml";
  const windowsRuntimeManifestFile =
    options.windowsRuntimeManifestFile ?? "coder-studio-runtime-win32-x64.manifest.json";
  const linuxRuntimeManifestFile =
    options.linuxRuntimeManifestFile ?? "coder-studio-server-runtime-linux-x64.manifest.json";
  const outputFile = options.outputFile ?? "desktop-channel.json";
  const buildInfo = parseDesktopBuildInfo(await readJson(directory, buildInfoFile));
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
    (await readRegularFile(directory, updaterMetadataFile)).toString("utf8")
  );
  if (updater.version !== buildInfo.shellVersion) {
    throw new Error("Electron updater metadata does not match Shell build info");
  }
  const windows = parseNetworkRuntimeManifest(
    await readJson(directory, windowsRuntimeManifestFile)
  );
  const linux = parseNetworkRuntimeManifest(await readJson(directory, linuxRuntimeManifestFile));
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
      updaterMetadata: updaterMetadataFile,
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
        manifest: windowsRuntimeManifestFile,
      },
      "linux-x64": {
        version: linux.runtimeVersion,
        publishedAt: linux.publishedAt,
        manifest: linuxRuntimeManifestFile,
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
  await readRegularFile(directory, buildInfoFile);
  if (outputFile !== basename(outputFile) || outputFile === "." || outputFile === "..") {
    throw new Error(`Desktop channel output path is unsafe: ${outputFile}`);
  }
  await writeJsonFileAtomic(resolve(directory, outputFile), channel);
  return channel;
}

async function copyRegularFiles(
  sourceDirectory: string,
  destinationDirectory: string,
  filenames: string[]
): Promise<string[]> {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  await mkdir(destination, { recursive: true });
  await assertReleaseDirectory(destination);
  for (const filename of filenames) {
    await readRegularFile(source, filename);
    const destinationPath = resolve(destination, filename);
    try {
      const metadata = await lstat(destinationPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Carry-forward destination must not be a symbolic link: ${filename}`);
      }
    } catch (destinationError) {
      if ((destinationError as NodeJS.ErrnoException).code !== "ENOENT") throw destinationError;
    }
    await copyFile(resolve(source, filename), destinationPath);
  }
  return filenames;
}

export async function prepareModernDesktopBase(directoryValue: string): Promise<string[]> {
  const directory = resolve(directoryValue);
  await assertReleaseDirectory(directory);
  const updater = parseUpdaterMetadata(
    (await readRegularFile(directory, "latest.yml")).toString("utf8")
  );
  await Promise.all([
    readRegularFile(directory, updater.path),
    readRegularFile(directory, `${updater.path}.blockmap`),
  ]);
  const copied = [
    "build-info-modern.json",
    MODERN_LINUX_RUNTIME_MANIFEST,
    MODERN_WINDOWS_RUNTIME_MANIFEST,
    "modern.yml",
  ];
  await Promise.all([
    copyFile(resolve(directory, "build-info.json"), resolve(directory, "build-info-modern.json")),
    copyFile(resolve(directory, "latest.yml"), resolve(directory, "modern.yml")),
    copyFile(
      resolve(directory, "coder-studio-runtime-win32-x64.manifest.json"),
      resolve(directory, MODERN_WINDOWS_RUNTIME_MANIFEST)
    ),
    copyFile(
      resolve(directory, "coder-studio-server-runtime-linux-x64.manifest.json"),
      resolve(directory, MODERN_LINUX_RUNTIME_MANIFEST)
    ),
  ]);
  try {
    await readRegularFile(directory, "desktop-channel.json");
    await copyFile(
      resolve(directory, "desktop-channel.json"),
      resolve(directory, "desktop-channel-modern.json")
    );
    copied.push("desktop-channel-modern.json");
  } catch (channelError) {
    if ((channelError as NodeJS.ErrnoException).code !== "ENOENT") throw channelError;
  }
  return copied.sort();
}

export async function carryForwardModernDesktopBase(
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
    (await readRegularFile(previous, "modern.yml")).toString("utf8")
  );
  return copyRegularFiles(
    previous,
    destination,
    [
      updater.path,
      `${updater.path}.blockmap`,
      "build-info-modern.json",
      "desktop-channel-modern.json",
      "modern.yml",
    ].sort()
  );
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
  return copyRegularFiles(previous, destination, filenames);
}

export async function carryForwardDesktopShellBase(
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
  return copyRegularFiles(
    previous,
    destination,
    [
      updater.path,
      `${updater.path}.blockmap`,
      "build-info.json",
      "desktop-channel.json",
      "latest.yml",
    ].sort()
  );
}

export async function carryForwardLegacyDesktopBase(
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
  const channel = (await readJson(previous, "desktop-channel.json")) as DesktopChannel;
  const runtimeAssets: string[] = [];
  for (const target of ["win32-x64", "linux-x64"] as const) {
    const manifestFile = channel.runtimes?.[target]?.manifest;
    if (typeof manifestFile !== "string") {
      throw new Error(`Previous Desktop channel has no ${target} Runtime manifest`);
    }
    const manifest = (await readJson(previous, manifestFile)) as { packageFile?: unknown };
    if (typeof manifest.packageFile !== "string") {
      throw new Error(`Previous ${target} Runtime manifest has no packageFile`);
    }
    runtimeAssets.push(manifestFile, manifest.packageFile);
  }
  return copyRegularFiles(
    previous,
    destination,
    [
      updater.path,
      `${updater.path}.blockmap`,
      "build-info.json",
      "desktop-channel.json",
      "latest.yml",
      ...runtimeAssets,
    ].sort()
  );
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
  let carryForwardShellFrom = "";
  let carryForwardLegacyFrom = "";
  let carryForwardModernFrom = "";
  let prepareModernBase = false;
  let buildInfoFile = "build-info.json";
  let updaterMetadataFile: DesktopChannel["shell"]["updaterMetadata"] = "latest.yml";
  let windowsRuntimeManifestFile = "coder-studio-runtime-win32-x64.manifest.json";
  let linuxRuntimeManifestFile = "coder-studio-server-runtime-linux-x64.manifest.json";
  let outputFile = "desktop-channel.json";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--directory") directory = readArgumentValue(argv, ++index, argument);
    else if (argument === "--release-tag") releaseTag = readArgumentValue(argv, ++index, argument);
    else if (argument === "--generated-at")
      generatedAt = readArgumentValue(argv, ++index, argument);
    else if (argument === "--private-key")
      privateKeyPath = readArgumentValue(argv, ++index, argument);
    else if (argument === "--build-info")
      buildInfoFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--updater-metadata") {
      const value = readArgumentValue(argv, ++index, argument);
      if (value !== "latest.yml" && value !== "modern.yml") {
        throw new Error("Invalid --updater-metadata");
      }
      updaterMetadataFile = value;
    } else if (argument === "--output") outputFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--windows-runtime-manifest")
      windowsRuntimeManifestFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--linux-runtime-manifest")
      linuxRuntimeManifestFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--prepare-modern-base") prepareModernBase = true;
    else if (argument === "--carry-forward-from") {
      carryForwardFrom = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--carry-forward-shell-from") {
      carryForwardShellFrom = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--carry-forward-legacy-from") {
      carryForwardLegacyFrom = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--carry-forward-modern-from") {
      carryForwardModernFrom = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--channel") {
      const value = readArgumentValue(argv, ++index, argument);
      if (value !== "stable" && value !== "prerelease") throw new Error("Invalid --channel");
      channel = value;
    } else throw new Error(`Unknown Desktop channel option: ${argument}`);
  }
  if (
    prepareModernBase ||
    carryForwardFrom ||
    carryForwardShellFrom ||
    carryForwardLegacyFrom ||
    carryForwardModernFrom
  ) {
    const operationCount = [
      prepareModernBase,
      Boolean(carryForwardFrom),
      Boolean(carryForwardShellFrom),
      Boolean(carryForwardLegacyFrom),
      Boolean(carryForwardModernFrom),
    ].filter(Boolean).length;
    if (
      operationCount !== 1 ||
      !directory ||
      releaseTag ||
      channel ||
      generatedAt ||
      privateKeyPath ||
      buildInfoFile !== "build-info.json" ||
      updaterMetadataFile !== "latest.yml" ||
      windowsRuntimeManifestFile !== "coder-studio-runtime-win32-x64.manifest.json" ||
      linuxRuntimeManifestFile !== "coder-studio-server-runtime-linux-x64.manifest.json" ||
      outputFile !== "desktop-channel.json"
    ) {
      throw new Error("Desktop base operations require only --directory and one base option");
    }
    if (prepareModernBase) {
      await prepareModernDesktopBase(directory);
      success(`Modern Desktop base prepared in ${resolve(directory)}`);
    } else if (carryForwardModernFrom) {
      await carryForwardModernDesktopBase(carryForwardModernFrom, directory);
      success(`Immutable modern Desktop base carried forward to ${resolve(directory)}`);
    } else if (carryForwardShellFrom) {
      await carryForwardDesktopShellBase(carryForwardShellFrom, directory);
      success(`Immutable legacy Desktop Shell carried forward to ${resolve(directory)}`);
    } else if (carryForwardLegacyFrom) {
      await carryForwardLegacyDesktopBase(carryForwardLegacyFrom, directory);
      success(`Frozen legacy Desktop channel carried forward to ${resolve(directory)}`);
    } else {
      await carryForwardDesktopBase(carryForwardFrom, directory);
      success(`Immutable legacy Desktop base carried forward to ${resolve(directory)}`);
    }
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
    buildInfoFile,
    updaterMetadataFile,
    windowsRuntimeManifestFile,
    linuxRuntimeManifestFile,
    outputFile,
  });
  success(`Signed Desktop channel written to ${resolve(directory, outputFile)}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((channelError) => {
    error(channelError instanceof Error ? channelError.message : String(channelError));
    process.exit(1);
  });
}
