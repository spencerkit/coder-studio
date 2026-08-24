import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNetworkRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { buildProductChannel } from "./build-desktop-channel.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const WINDOWS_RUNTIME_MANIFEST = "coder-studio-runtime-win32-x64.manifest.json";
const LINUX_RUNTIME_MANIFEST = "coder-studio-server-runtime-linux-x64.manifest.json";
const CLI_TARBALL = "coder-studio-cli.tgz";

interface PrepareProductReleaseBundleCommand {
  directory: string;
  releaseTag: string;
  privateKeyPath?: string;
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function tryReadJson(path: string): unknown | null {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function resolveProductIdentity(directory: string): { version: string; generatedAt: string } {
  const windows = parseNetworkRuntimeManifest(
    readJson(resolve(directory, WINDOWS_RUNTIME_MANIFEST))
  );
  const linux = parseNetworkRuntimeManifest(readJson(resolve(directory, LINUX_RUNTIME_MANIFEST)));
  const modernBuildInfo = tryReadJson(resolve(directory, "build-info-modern.json"));
  const legacyBuildInfo = tryReadJson(resolve(directory, "build-info.json"));
  if (
    windows.runtimeVersion !== linux.runtimeVersion ||
    windows.publishedAt !== linux.publishedAt
  ) {
    throw new Error("Legacy Product Runtime manifests do not describe one Product release");
  }
  const generatedAt =
    readStringProperty(modernBuildInfo, "publishedAt") ??
    readStringProperty(modernBuildInfo, "builtAt") ??
    readStringProperty(legacyBuildInfo, "publishedAt") ??
    readStringProperty(legacyBuildInfo, "builtAt") ??
    windows.publishedAt;
  return { version: windows.runtimeVersion, generatedAt };
}

async function ensureCliTarball(directory: string, version: string): Promise<void> {
  const target = resolve(directory, CLI_TARBALL);
  if (await isRegularFile(target)) return;
  const pack = spawnSync(
    "npm",
    ["pack", `@spencer-kit/coder-studio@${version}`, "--pack-destination", directory],
    { encoding: "utf8" }
  );
  if (pack.status !== 0) {
    throw new Error(
      `Unable to download CLI package ${version}: ${(pack.stderr || pack.stdout).trim() || "npm pack failed"}`
    );
  }
  const filename = pack.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!filename) throw new Error(`npm pack did not report a CLI tarball for ${version}`);
  const source = resolve(directory, filename);
  if (!(await isRegularFile(source))) {
    throw new Error(`npm pack did not create the expected CLI tarball: ${filename}`);
  }
  if (source !== target) {
    await rename(source, target);
  }
}

async function ensureProductChannel(
  command: PrepareProductReleaseBundleCommand,
  identity: { version: string; generatedAt: string }
): Promise<void> {
  const target = resolve(command.directory, "product-channel.json");
  if (await isRegularFile(target)) return;
  if (!command.privateKeyPath) {
    throw new Error(
      "A runtime signing private key is required to reconstruct product-channel.json"
    );
  }
  const privateKeyPem = readFileSync(resolve(command.privateKeyPath), "utf8");
  await buildProductChannel({
    directory: command.directory,
    generatedAt: identity.generatedAt,
    privateKeyPem,
    productVersion: identity.version,
    releaseTag: command.releaseTag,
  });
}

function parseCommand(argv: string[]): PrepareProductReleaseBundleCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  let directory = "";
  let releaseTag = "";
  let privateKeyPath = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (argument === "--directory") directory = normalized[++index] ?? "";
    else if (argument === "--release-tag") releaseTag = normalized[++index] ?? "";
    else if (argument === "--private-key") privateKeyPath = normalized[++index] ?? "";
    else throw new Error(`Unknown Product bundle option: ${argument ?? ""}`);
  }
  if (!directory || !releaseTag) {
    throw new Error("--directory and --release-tag are required");
  }
  return {
    directory: resolve(directory),
    releaseTag: releaseTag.trim(),
    privateKeyPath: privateKeyPath ? resolve(privateKeyPath) : undefined,
  };
}

export async function prepareProductReleaseBundle(
  command: PrepareProductReleaseBundleCommand
): Promise<{ version: string; generatedAt: string }> {
  const identity = resolveProductIdentity(command.directory);
  await ensureCliTarball(command.directory, identity.version);
  await ensureProductChannel(command, identity);
  return identity;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const identity = await prepareProductReleaseBundle(command);
  success(
    `Prepared Product bundle for ${command.releaseTag} (${identity.version}) at ${command.directory}`
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((bundleError) => {
    error(bundleError instanceof Error ? bundleError.message : String(bundleError));
    process.exit(1);
  });
}
