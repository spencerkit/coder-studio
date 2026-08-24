import { createHash, createPrivateKey, sign } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { writeJsonFileAtomic } from "../packages/desktop/src/atomic-json-file.js";
import { parseDesktopBuildInfo } from "../packages/desktop/src/build-info.js";
import type { DesktopChannel } from "../packages/desktop/src/desktop-channel.js";
import { parseEngineManifest } from "../packages/desktop/src/engine-manifest.js";
import {
  type ProductChannel,
  parseFactoryProductProvenance,
} from "../packages/desktop/src/product-channel.js";
import {
  assertSafeReleaseAssetName,
  assertSafeReleaseTag,
  parseChannelTimestamp,
  readChannelString,
} from "../packages/desktop/src/release-channel.js";
import { parseNetworkRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { parseUpdaterMetadata } from "./desktop-release-artifacts.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const WINDOWS_RUNTIME_MANIFEST = "coder-studio-runtime-win32-x64.manifest.json";
const LINUX_RUNTIME_MANIFEST = "coder-studio-server-runtime-linux-x64.manifest.json";
const WSL_ENGINE_MANIFEST = "coder-studio-engine-linux-x64.manifest.json";

interface CommonBuildOptions {
  directory: string;
  releaseTag: string;
  generatedAt: string;
  privateKeyPem: string;
  outputFile?: string;
}

export interface BuildProductChannelOptions extends CommonBuildOptions {
  productVersion: string;
  windowsRuntimeManifestFile?: string;
  linuxRuntimeManifestFile?: string;
}

export interface BuildDesktopChannelOptions extends CommonBuildOptions {
  buildInfoFile?: string;
  updaterMetadataFile?: string;
  wslEngineManifestFile?: string;
  factoryProductFile: string;
}

export type ReleaseChannelCommand =
  | {
      kind: "product";
      directory: string;
      releaseTag: string;
      generatedAt: string;
      privateKeyPath: string;
      productVersion: string;
      outputFile: string;
    }
  | {
      kind: "desktop";
      directory: string;
      releaseTag: string;
      generatedAt: string;
      privateKeyPath: string;
      factoryProductFile: string;
      outputFile: string;
    };

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

async function assertReleaseDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Release channel path must be a real directory: ${directory}`);
  }
}

async function readRegularFile(root: string, filename: string): Promise<Buffer> {
  assertSafeReleaseAssetName(filename);
  const normalizedRoot = resolve(root);
  const path = resolve(normalizedRoot, filename);
  if (!isInside(normalizedRoot, path)) {
    throw new Error(`Release channel asset escaped its directory: ${filename}`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Release channel asset must be a regular file: ${filename}`);
  }
  return readFile(path);
}

async function readJson(root: string, filename: string): Promise<unknown> {
  return JSON.parse((await readRegularFile(root, filename)).toString("utf8"));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function signChannel<T extends object>(unsigned: T, privateKeyPem: string) {
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519" as const,
      value: sign(
        null,
        canonicalSigningPayload(unsigned),
        createPrivateKey(privateKeyPem)
      ).toString("base64"),
    },
  };
}

function assertRuntimePair(
  windows: ReturnType<typeof parseNetworkRuntimeManifest>,
  linux: ReturnType<typeof parseNetworkRuntimeManifest>,
  productVersion: string
): void {
  const shared = [
    "runtimeVersion",
    "publishedAt",
    "minShellVersion",
    "requiredEngineVersion",
    "requiredNodeVersion",
    "runtimeHostApiVersion",
    "apiProtocolVersion",
    "dataSchemaVersion",
  ] as const;
  if (
    windows.runtimeVersion !== productVersion ||
    linux.runtimeVersion !== productVersion ||
    shared.some((field) => windows[field] !== linux[field])
  ) {
    throw new Error("Windows and WSL Runtime metadata must describe one Product release");
  }
  if (
    windows.platform !== "win32" ||
    linux.platform !== "linux" ||
    windows.arch !== "x64" ||
    linux.arch !== "x64"
  ) {
    throw new Error("Product Runtime manifests must target win32-x64 and linux-x64");
  }
}

function validateOutputFile(outputFile: string): void {
  assertSafeReleaseAssetName(outputFile);
  if (outputFile !== basename(outputFile)) throw new Error("Release channel output path is unsafe");
}

export async function buildProductChannel(
  options: BuildProductChannelOptions
): Promise<ProductChannel> {
  const directory = resolve(options.directory);
  await assertReleaseDirectory(directory);
  const windowsManifest = options.windowsRuntimeManifestFile ?? WINDOWS_RUNTIME_MANIFEST;
  const linuxManifest = options.linuxRuntimeManifestFile ?? LINUX_RUNTIME_MANIFEST;
  const outputFile = options.outputFile ?? "product-channel.json";
  validateOutputFile(outputFile);
  const [windowsBytes, linuxBytes] = await Promise.all([
    readRegularFile(directory, windowsManifest),
    readRegularFile(directory, linuxManifest),
  ]);
  const windows = parseNetworkRuntimeManifest(JSON.parse(windowsBytes.toString("utf8")));
  const linux = parseNetworkRuntimeManifest(JSON.parse(linuxBytes.toString("utf8")));
  const productVersion = readChannelString(options.productVersion, "Product version");
  assertRuntimePair(windows, linux, productVersion);
  const releaseTag = readChannelString(options.releaseTag, "Product release tag");
  assertSafeReleaseTag(releaseTag);
  const unsigned: Omit<ProductChannel, "signature"> = {
    schemaVersion: 1,
    channel: "product",
    version: productVersion,
    releaseTag,
    generatedAt: parseChannelTimestamp(options.generatedAt, "Product channel generatedAt"),
    minShellVersion: windows.minShellVersion,
    requirements: {
      engineVersion: windows.requiredEngineVersion,
      nodeVersion: windows.requiredNodeVersion,
      runtimeHostApiVersion: windows.runtimeHostApiVersion,
      apiProtocolVersion: windows.apiProtocolVersion,
      dataSchemaVersion: windows.dataSchemaVersion,
    },
    runtimes: {
      "win32-x64": {
        version: productVersion,
        publishedAt: windows.publishedAt,
        manifest: windowsManifest,
        manifestSha256: sha256(windowsBytes),
      },
      "linux-x64": {
        version: productVersion,
        publishedAt: linux.publishedAt,
        manifest: linuxManifest,
        manifestSha256: sha256(linuxBytes),
      },
    },
  };
  const channel = signChannel(unsigned, options.privateKeyPem);
  await writeJsonFileAtomic(resolve(directory, outputFile), channel);
  return channel;
}

export async function buildDesktopChannel(
  options: BuildDesktopChannelOptions
): Promise<DesktopChannel> {
  const directory = resolve(options.directory);
  await assertReleaseDirectory(directory);
  const buildInfoFile = options.buildInfoFile ?? "build-info.json";
  const updaterMetadataFile = options.updaterMetadataFile ?? "latest.yml";
  const engineManifestFile = options.wslEngineManifestFile ?? WSL_ENGINE_MANIFEST;
  const outputFile = options.outputFile ?? "desktop-channel.json";
  validateOutputFile(outputFile);
  const [buildInfo, updaterBytes, engineBytes, factoryValue] = await Promise.all([
    readJson(directory, buildInfoFile).then(parseDesktopBuildInfo),
    readRegularFile(directory, updaterMetadataFile),
    readRegularFile(directory, engineManifestFile),
    readJson(directory, options.factoryProductFile),
  ]);
  const updater = parseUpdaterMetadata(updaterBytes.toString("utf8"));
  const engine = parseEngineManifest(JSON.parse(engineBytes.toString("utf8")));
  const factoryProduct = parseFactoryProductProvenance(factoryValue);
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
  if (updater.version !== buildInfo.shellVersion) {
    throw new Error("Electron updater metadata does not match Shell build info");
  }
  await readRegularFile(directory, updater.path);
  if (
    engine.engineVersion !== buildInfo.engineVersion ||
    engine.nodeVersion !== buildInfo.nodeVersion ||
    engine.arch !== "x64"
  ) {
    throw new Error("WSL Engine metadata does not match packaged Shell capabilities");
  }
  const releaseTag = readChannelString(options.releaseTag, "Desktop release tag");
  assertSafeReleaseTag(releaseTag);
  const unsigned: Omit<DesktopChannel, "signature"> = {
    schemaVersion: 1,
    channel: "desktop",
    version: buildInfo.shellVersion,
    releaseTag,
    generatedAt: parseChannelTimestamp(options.generatedAt, "Desktop channel generatedAt"),
    shell: {
      version: buildInfo.shellVersion,
      publishedAt: buildInfo.publishedAt,
      updaterMetadata: updaterMetadataFile,
      installer: updater.path,
      engineVersion: buildInfo.engineVersion,
      nodeVersion: buildInfo.nodeVersion,
      runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
      apiProtocolVersion: buildInfo.apiProtocolVersion,
      dataSchemaVersion: buildInfo.dataSchemaVersion,
    },
    wslEngine: {
      version: engine.engineVersion,
      nodeVersion: engine.nodeVersion,
      manifest: engineManifestFile,
      manifestSha256: sha256(engineBytes),
    },
    factoryProduct: {
      version: factoryProduct.version,
      releaseTag: factoryProduct.releaseTag,
      runtimes: factoryProduct.runtimes,
    },
  };
  const channel = signChannel(unsigned, options.privateKeyPem);
  await writeJsonFileAtomic(resolve(directory, outputFile), channel);
  return channel;
}

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function normalizeReleaseChannelArgs(argv: string[]): string[] {
  const normalized = argv[0] === "--" ? argv.slice(1) : [...argv];
  if ((normalized[0] === "product" || normalized[0] === "desktop") && normalized[1] === "--") {
    normalized.splice(1, 1);
  }
  return normalized;
}

export function parseReleaseChannelCommand(argvValue: string[]): ReleaseChannelCommand {
  const argv = normalizeReleaseChannelArgs(argvValue);
  const [kind, ...args] = argv;
  if (kind !== "product" && kind !== "desktop") {
    throw new Error("Release channel command must be product or desktop");
  }
  let directory = "";
  let releaseTag = "";
  let generatedAt = "";
  let privateKeyPath = "";
  let productVersion = "";
  let factoryProductFile = "factory-product.json";
  let outputFile = kind === "product" ? "product-channel.json" : "desktop-channel.json";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--directory") directory = readArgumentValue(args, ++index, argument);
    else if (argument === "--release-tag") releaseTag = readArgumentValue(args, ++index, argument);
    else if (argument === "--generated-at")
      generatedAt = readArgumentValue(args, ++index, argument);
    else if (argument === "--private-key")
      privateKeyPath = readArgumentValue(args, ++index, argument);
    else if (argument === "--output") outputFile = readArgumentValue(args, ++index, argument);
    else if (argument === "--product-version" && kind === "product") {
      productVersion = readArgumentValue(args, ++index, argument);
    } else if (argument === "--factory-product" && kind === "desktop") {
      factoryProductFile = readArgumentValue(args, ++index, argument);
    } else {
      throw new Error(`Unknown release channel option: ${argument ?? ""}`);
    }
  }
  if (!directory || !releaseTag || !generatedAt || !privateKeyPath) {
    throw new Error("--directory, --release-tag, --generated-at, and --private-key are required");
  }
  if (kind === "product") {
    if (!productVersion) throw new Error("Product release channel requires --product-version");
    return {
      kind,
      directory: resolve(directory),
      releaseTag,
      generatedAt,
      privateKeyPath: resolve(privateKeyPath),
      productVersion,
      outputFile,
    };
  }
  return {
    kind,
    directory: resolve(directory),
    releaseTag,
    generatedAt,
    privateKeyPath: resolve(privateKeyPath),
    factoryProductFile,
    outputFile,
  };
}

async function main(): Promise<void> {
  const command = parseReleaseChannelCommand(process.argv.slice(2));
  const privateKeyPem = await readFile(command.privateKeyPath, "utf8");
  if (command.kind === "product") {
    await buildProductChannel({ ...command, privateKeyPem });
    success(`Signed Product channel written to ${resolve(command.directory, command.outputFile)}`);
  } else {
    await buildDesktopChannel({ ...command, privateKeyPem });
    success(`Signed Desktop channel written to ${resolve(command.directory, command.outputFile)}`);
  }
}

if (isDirectExecution(import.meta.url)) {
  main().catch((channelError) => {
    error(channelError instanceof Error ? channelError.message : String(channelError));
    process.exit(1);
  });
}
