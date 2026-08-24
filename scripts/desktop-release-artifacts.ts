import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { extract } from "tar";
import {
  type DesktopBuildInfo,
  parseDesktopBuildInfo,
} from "../packages/desktop/src/build-info.js";
import {
  type DesktopChannel,
  parseDesktopChannel,
} from "../packages/desktop/src/desktop-channel.js";
import {
  type EngineManifest,
  parseEngineManifest,
  verifyEngineManifestSignature,
} from "../packages/desktop/src/engine-manifest.js";
import {
  type FactoryProductProvenance,
  type ProductChannel,
  type ProductChannelRuntime,
  parseFactoryProductProvenance,
  parseProductChannel,
} from "../packages/desktop/src/product-channel.js";
import {
  compareVersions,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  isSafeRuntimeRelativePath,
  parseNetworkRuntimeManifest,
  type RuntimeFileEntry,
  type RuntimeManifest,
  type RuntimeManifestV2,
  verifyRuntimeManifestSignature,
} from "../packages/desktop/src/runtime-manifest.js";
import { error, info, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";
import { validateCliPackageArchive } from "./validate-cli-package.js";

export type ProductReleaseComponent = "cli" | "win-runtime" | "wsl-runtime";
export type DesktopReleaseComponent = "windows" | "wsl-engine";

export interface StageProductReleaseOptions {
  directory: string;
  components: ProductReleaseComponent[];
  cliTarballPath?: string;
  releaseRoot?: string;
}

export interface StageDesktopReleaseOptions {
  directory: string;
  components: DesktopReleaseComponent[];
  releaseRoot?: string;
}

interface ValidationOptions {
  directory: string;
  allowUnsigned: boolean;
  publicKeyPem?: string;
}

export interface ValidateProductReleaseOptions extends ValidationOptions {
  sourcePackageJsonPath?: string;
}

export interface ValidateDesktopReleaseOptions extends ValidationOptions {}

export type ReleaseArtifactsCommand =
  | ({ action: "stage-product" } & StageProductReleaseOptions)
  | ({ action: "validate-product" } & ValidateProductReleaseOptions)
  | ({ action: "stage-desktop" } & StageDesktopReleaseOptions)
  | ({ action: "validate-desktop" } & ValidateDesktopReleaseOptions);

const RELEASE_ROOT = resolve(ROOT_DIR, "release");
const PRODUCT_CHANNEL_URL =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json";
const DESKTOP_CHANNEL_URL =
  "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json";
const CLI_PACKAGE_NAME = "@spencer-kit/coder-studio";
const PRODUCT_COMPONENTS = new Set<ProductReleaseComponent>(["cli", "win-runtime", "wsl-runtime"]);
const DESKTOP_COMPONENTS = new Set<DesktopReleaseComponent>(["windows", "wsl-engine"]);
const ALLOWED_EMPTY_WINDOWS_ENGINE_FILES = new Set(["node_modules/node-addon-api/nothing.c"]);

function isAllowedEmptyWindowsEngineFile(file: string): boolean {
  return (
    ALLOWED_EMPTY_WINDOWS_ENGINE_FILES.has(file) ||
    file.endsWith("/__init__.py") ||
    file.endsWith("/py.typed")
  );
}

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseComponents<T extends string>(
  value: string,
  allowed: ReadonlySet<T>,
  label: string
): T[] {
  const components = [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
  if (components.length === 0 || components.some((entry) => !allowed.has(entry as T))) {
    throw new Error(`${label} must contain one or more of: ${[...allowed].join(", ")}`);
  }
  return components as T[];
}

export function parseReleaseArtifactsCommand(argv: string[]): ReleaseArtifactsCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [action, ...args] = normalized;
  if (
    action !== "stage-product" &&
    action !== "validate-product" &&
    action !== "stage-desktop" &&
    action !== "validate-desktop"
  ) {
    throw new Error(
      "Release artifacts command must be stage-product, validate-product, stage-desktop, or validate-desktop"
    );
  }

  let directory = "";
  let productComponents: ProductReleaseComponent[] = [];
  let desktopComponents: DesktopReleaseComponent[] = [];
  let cliTarballPath: string | undefined;
  let sourcePackageJsonPath: string | undefined;
  let allowUnsigned = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--directory":
        directory = resolve(readArgumentValue(args, ++index, "--directory"));
        break;
      case "--components": {
        const value = readArgumentValue(args, ++index, "--components");
        if (action === "stage-product") {
          productComponents = parseComponents(value, PRODUCT_COMPONENTS, "--components");
        } else if (action === "stage-desktop") {
          desktopComponents = parseComponents(value, DESKTOP_COMPONENTS, "--components");
        } else {
          throw new Error(`Unknown release artifacts option for ${action}: ${argument}`);
        }
        break;
      }
      case "--cli-tarball":
        if (action !== "stage-product") {
          throw new Error(`Unknown release artifacts option for ${action}: ${argument}`);
        }
        cliTarballPath = resolve(readArgumentValue(args, ++index, "--cli-tarball"));
        break;
      case "--source-package-json":
        if (action !== "validate-product") {
          throw new Error(`Unknown release artifacts option for ${action}: ${argument}`);
        }
        sourcePackageJsonPath = resolve(readArgumentValue(args, ++index, "--source-package-json"));
        break;
      case "--allow-unsigned":
        if (action === "stage-product" || action === "stage-desktop") {
          throw new Error(`Unknown release artifacts option for ${action}: ${argument}`);
        }
        allowUnsigned = true;
        break;
      default:
        throw new Error(`Unknown release artifacts option for ${action}: ${argument}`);
    }
  }
  if (!directory) throw new Error("--directory is required");
  if (action === "stage-product") {
    if (productComponents.length === 0) throw new Error("--components is required");
    if (productComponents.includes("cli") && !cliTarballPath) {
      throw new Error("--cli-tarball is required when staging the CLI");
    }
    return { action, directory, components: productComponents, cliTarballPath };
  }
  if (action === "stage-desktop") {
    if (desktopComponents.length === 0) throw new Error("--components is required");
    return { action, directory, components: desktopComponents };
  }
  const validation = {
    action,
    directory,
    allowUnsigned,
    publicKeyPem: process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY?.trim(),
  };
  return action === "validate-product" ? { ...validation, sourcePackageJsonPath } : validation;
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`);
}

function assertSafeStageDirectory(releaseRoot: string, directory: string): void {
  if (!isInside(releaseRoot, directory)) {
    throw new Error(`Release staging directory must be inside ${releaseRoot}`);
  }
}

async function readRegularFile(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Release asset must be a regular file, not a symbolic link: ${path}`);
  }
  return readFile(path);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readRegularFile(path)).toString("utf8"));
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function parseUpdaterMetadata(contents: string): {
  version: string;
  path: string;
  sha512: string;
  size: number;
} {
  const versionMatch = contents.match(/^version:\s*(.+?)\s*$/m);
  const pathMatch = contents.match(/^path:\s*(.+?)\s*$/m);
  const sha512Match = contents.match(/^sha512:\s*(.+?)\s*$/m);
  const fileUrlMatch = contents.match(/^[ \t]+-\s+url:\s*(.+?)\s*$/m);
  const fileSha512Match = contents.match(/^[ \t]+sha512:\s*(.+?)\s*$/m);
  const sizeMatch = contents.match(/^[ \t]+size:\s*(.+?)\s*$/m);
  const version = versionMatch ? parseYamlScalar(versionMatch[1] ?? "") : "";
  const path = pathMatch ? parseYamlScalar(pathMatch[1] ?? "") : "";
  const sha512 = sha512Match ? parseYamlScalar(sha512Match[1] ?? "") : "";
  const fileUrl = fileUrlMatch ? parseYamlScalar(fileUrlMatch[1] ?? "") : "";
  const fileSha512 = fileSha512Match ? parseYamlScalar(fileSha512Match[1] ?? "") : "";
  const size = Number(sizeMatch ? parseYamlScalar(sizeMatch[1] ?? "") : "");
  const sha512Bytes = Buffer.from(sha512, "base64");
  if (!version || !path || path !== basename(path) || path === "." || path === "..") {
    throw new Error("Desktop latest.yml has invalid version or path metadata");
  }
  if (
    !sha512 ||
    fileUrl !== path ||
    fileSha512 !== sha512 ||
    sha512Bytes.byteLength !== 64 ||
    sha512Bytes.toString("base64") !== sha512 ||
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw new Error("Desktop latest.yml has invalid SHA-512 or size metadata");
  }
  return { version, path, sha512, size };
}

async function copyArtifact(source: string, destinationDirectory: string, name = basename(source)) {
  await readRegularFile(source);
  await copyFile(source, resolve(destinationDirectory, name));
}

async function copyRegularTree(source: string, destination: string): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Release staging source contains a symbolic link: ${source}`);
  }
  if (metadata.isFile()) {
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Release staging source is not a regular file or directory: ${source}`);
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source);
  await Promise.all(
    entries.map((entry) => copyRegularTree(resolve(source, entry), resolve(destination, entry)))
  );
}

async function stageManifestArtifact(
  manifestPath: string,
  sourceDirectory: string,
  destinationDirectory: string
): Promise<void> {
  const manifest = (await readJson(manifestPath)) as { packageFile?: unknown };
  if (
    typeof manifest.packageFile !== "string" ||
    !manifest.packageFile ||
    manifest.packageFile !== basename(manifest.packageFile)
  ) {
    throw new Error(`Release manifest has an invalid packageFile: ${manifestPath}`);
  }
  await Promise.all([
    copyArtifact(manifestPath, destinationDirectory),
    copyArtifact(resolve(sourceDirectory, manifest.packageFile), destinationDirectory),
  ]);
}

async function stageWindowsDesktop(
  releaseRoot: string,
  destinationDirectory: string
): Promise<void> {
  const sourceDirectory = resolve(releaseRoot, "desktop");
  const metadataPath = resolve(sourceDirectory, "latest.yml");
  const metadata = parseUpdaterMetadata((await readRegularFile(metadataPath)).toString("utf8"));
  await Promise.all([
    copyArtifact(metadataPath, destinationDirectory),
    copyArtifact(resolve(sourceDirectory, metadata.path), destinationDirectory),
    copyArtifact(resolve(sourceDirectory, `${metadata.path}.blockmap`), destinationDirectory),
    copyArtifact(resolve(sourceDirectory, "build-info.json"), destinationDirectory),
    copyArtifact(
      resolve(sourceDirectory, "win-unpacked/resources/factory-product.json"),
      destinationDirectory
    ),
    copyRegularTree(
      resolve(sourceDirectory, "win-unpacked/resources/engine"),
      resolve(destinationDirectory, "windows-engine")
    ),
    copyRegularTree(
      resolve(sourceDirectory, "win-unpacked/resources/factory-runtime"),
      resolve(destinationDirectory, "factory-runtime")
    ),
  ]);
}

export async function stageProductReleaseArtifacts(
  options: StageProductReleaseOptions
): Promise<void> {
  const releaseRoot = resolve(options.releaseRoot ?? RELEASE_ROOT);
  const directory = resolve(options.directory);
  assertSafeStageDirectory(releaseRoot, directory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const component of options.components) {
    if (component === "cli") {
      if (!options.cliTarballPath) throw new Error("CLI staging requires a tarball path");
      await copyArtifact(resolve(options.cliTarballPath), directory, "coder-studio-cli.tgz");
    } else if (component === "win-runtime") {
      await stageManifestArtifact(
        resolve(releaseRoot, "runtime/coder-studio-runtime-win32-x64.manifest.json"),
        resolve(releaseRoot, "runtime"),
        directory
      );
    } else {
      await stageManifestArtifact(
        resolve(releaseRoot, "runtime/coder-studio-server-runtime-linux-x64.manifest.json"),
        resolve(releaseRoot, "runtime"),
        directory
      );
    }
  }
  success(`Product release artifacts staged at ${directory}`);
}

export async function stageDesktopReleaseArtifacts(
  options: StageDesktopReleaseOptions
): Promise<void> {
  const releaseRoot = resolve(options.releaseRoot ?? RELEASE_ROOT);
  const directory = resolve(options.directory);
  assertSafeStageDirectory(releaseRoot, directory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const component of options.components) {
    if (component === "windows") {
      await stageWindowsDesktop(releaseRoot, directory);
    } else {
      await stageManifestArtifact(
        resolve(releaseRoot, "engine/coder-studio-engine-linux-x64.manifest.json"),
        resolve(releaseRoot, "engine"),
        directory
      );
    }
  }
  success(`Desktop release artifacts staged at ${directory}`);
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Release contents include a symbolic link: ${entry.name}`);
    }
    if (metadata.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (metadata.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Release contents include an unsupported entry: ${entry.name}`);
  }
  return files.sort();
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await extract({
    cwd: destination,
    file: archivePath,
    strict: true,
    preservePaths: false,
    filter: (path) => {
      const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
      return !normalized || isSafeRuntimeRelativePath(normalized);
    },
  });
}

async function assertFileEntries(root: string, entries: RuntimeFileEntry[], label: string) {
  const expected = entries.map((entry) => entry.path).sort();
  const actual = await collectFiles(root);
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) {
    throw new Error(`${label} file set does not match its signed manifest`);
  }
  for (const entry of entries) {
    const actualEntry = await hashRuntimeFile(resolve(root, ...entry.path.split("/")));
    if (actualEntry.sha256 !== entry.sha256 || actualEntry.size !== entry.size) {
      throw new Error(`${label} verification failed: ${entry.path}`);
    }
  }
}

function signaturesMatch(expected: RuntimeManifest, actual: RuntimeManifest): boolean {
  return (
    getRuntimeManifestSigningPayload(expected).equals(getRuntimeManifestSigningPayload(actual)) &&
    expected.signature?.algorithm === actual.signature?.algorithm &&
    expected.signature?.value === actual.signature?.value
  );
}

function assertRuntimeSignature(manifest: RuntimeManifest, options: ValidationOptions): void {
  if (options.allowUnsigned && !options.publicKeyPem) return;
  if (!manifest.signature) {
    if (options.allowUnsigned) return;
    throw new Error(`Runtime ${manifest.runtimeVersion} is unsigned`);
  }
  if (!options.publicKeyPem) throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required");
  if (!verifyRuntimeManifestSignature(manifest, options.publicKeyPem)) {
    throw new Error(`Runtime ${manifest.runtimeVersion} signature is invalid`);
  }
}

async function validateRuntimeArtifact(
  options: ValidationOptions,
  identity: ProductChannelRuntime,
  expected: { platform: "win32" | "linux"; web: boolean }
): Promise<RuntimeManifestV2> {
  const manifestPath = resolve(options.directory, identity.manifest);
  const manifestBytes = await readRegularFile(manifestPath);
  const digest = createHash("sha256").update(manifestBytes).digest("hex");
  if (digest !== identity.manifestSha256) {
    throw new Error(`${identity.manifest} manifest digest does not match the Product channel`);
  }
  const manifest = parseNetworkRuntimeManifest(JSON.parse(manifestBytes.toString("utf8")));
  assertRuntimeSignature(manifest, options);
  const packagePrefix = expected.web ? "coder-studio-runtime" : "coder-studio-server-runtime";
  if (
    manifest.runtimeVersion !== identity.version ||
    manifest.publishedAt !== identity.publishedAt ||
    manifest.platform !== expected.platform ||
    manifest.arch !== "x64" ||
    manifest.entrypoint !== "server.mjs" ||
    manifest.webRoot !== (expected.web ? "web" : undefined) ||
    manifest.packageFile !== `${packagePrefix}-${identity.version}-${expected.platform}-x64.tgz`
  ) {
    throw new Error(`${identity.manifest} is incompatible with the Product release boundary`);
  }
  if (manifest.files.some((entry) => entry.path.endsWith(".map"))) {
    throw new Error(`${identity.manifest} contains source maps`);
  }
  const extractionRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-product-runtime-"));
  try {
    const packagePath = resolve(options.directory, manifest.packageFile);
    await readRegularFile(packagePath);
    await extractArchive(packagePath, extractionRoot);
    const embeddedManifestPath = resolve(extractionRoot, "manifest.json");
    const embeddedManifest = parseNetworkRuntimeManifest(await readJson(embeddedManifestPath));
    if (!signaturesMatch(manifest, embeddedManifest)) {
      throw new Error(`${identity.manifest} does not match its packaged manifest`);
    }
    await assertFileEntries(
      extractionRoot,
      [
        ...manifest.files,
        { path: "manifest.json", ...(await hashRuntimeFile(embeddedManifestPath)) },
      ],
      "Product Runtime archive"
    );
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
  return manifest;
}

function assertProductRuntimePair(
  channel: ProductChannel,
  windows: RuntimeManifestV2,
  linux: RuntimeManifestV2
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
    windows.runtimeVersion !== channel.version ||
    linux.runtimeVersion !== channel.version ||
    shared.some((field) => windows[field] !== linux[field])
  ) {
    throw new Error("Windows and WSL Runtime capabilities must describe one Product release");
  }
  if (
    windows.minShellVersion !== channel.minShellVersion ||
    windows.requiredEngineVersion !== channel.requirements.engineVersion ||
    windows.requiredNodeVersion !== channel.requirements.nodeVersion ||
    windows.runtimeHostApiVersion !== channel.requirements.runtimeHostApiVersion ||
    windows.apiProtocolVersion !== channel.requirements.apiProtocolVersion ||
    windows.dataSchemaVersion !== channel.requirements.dataSchemaVersion
  ) {
    throw new Error("Product Runtime capabilities do not match the signed Product channel");
  }
}

export async function validateProductReleaseArtifacts(
  options: ValidateProductReleaseOptions
): Promise<void> {
  const directory = resolve(options.directory);
  const normalizedOptions = { ...options, directory };
  if (!options.publicKeyPem && !options.allowUnsigned) {
    throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required for Product validation");
  }
  const channel = parseProductChannel(
    await readJson(resolve(directory, "product-channel.json")),
    options.publicKeyPem ?? "",
    PRODUCT_CHANNEL_URL,
    { allowUnsigned: options.allowUnsigned && !options.publicKeyPem }
  );
  const cli = await validateCliPackageArchive({
    tarballPath: resolve(directory, "coder-studio-cli.tgz"),
    sourcePackageJsonPath:
      options.sourcePackageJsonPath ?? resolve(ROOT_DIR, "packages/cli/package.json"),
  });
  if (cli.name !== CLI_PACKAGE_NAME) {
    throw new Error(`CLI package identity must be ${CLI_PACKAGE_NAME}`);
  }
  if (cli.version !== channel.version) {
    throw new Error("CLI version does not match the signed Product version");
  }
  info("Validating Product Windows Runtime");
  const windows = await validateRuntimeArtifact(normalizedOptions, channel.runtimes["win32-x64"], {
    platform: "win32",
    web: true,
  });
  info("Validating Product WSL Runtime");
  const linux = await validateRuntimeArtifact(normalizedOptions, channel.runtimes["linux-x64"], {
    platform: "linux",
    web: false,
  });
  assertProductRuntimePair(channel, windows, linux);
  success(`Product release artifacts are valid: ${directory}`);
}

async function validateDesktopInstaller(directory: string, channel: DesktopChannel): Promise<void> {
  const metadata = parseUpdaterMetadata(
    (await readRegularFile(resolve(directory, channel.shell.updaterMetadata))).toString("utf8")
  );
  if (metadata.version !== channel.version || metadata.path !== channel.shell.installer) {
    throw new Error("Desktop updater metadata does not match the signed Desktop channel");
  }
  const installerPath = resolve(directory, metadata.path);
  const [installer, blockmap] = await Promise.all([
    lstat(installerPath),
    lstat(resolve(directory, `${metadata.path}.blockmap`)),
  ]);
  if (
    !installer.isFile() ||
    installer.isSymbolicLink() ||
    installer.size <= 0 ||
    !blockmap.isFile() ||
    blockmap.isSymbolicLink() ||
    blockmap.size <= 0
  ) {
    throw new Error("Desktop installer or blockmap is empty");
  }
  if (installer.size !== metadata.size) {
    throw new Error("Desktop installer size does not match updater metadata");
  }
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(installerPath)) hash.update(chunk);
  if (hash.digest("base64") !== metadata.sha512) {
    throw new Error("Desktop installer SHA-512 does not match updater metadata");
  }
}

function assertBuildInfoMatchesChannel(buildInfo: DesktopBuildInfo, channel: DesktopChannel): void {
  const shell = channel.shell;
  if (
    buildInfo.shellVersion !== shell.version ||
    buildInfo.publishedAt !== shell.publishedAt ||
    buildInfo.engineVersion !== shell.engineVersion ||
    buildInfo.nodeVersion !== shell.nodeVersion ||
    buildInfo.runtimeHostApiVersion !== shell.runtimeHostApiVersion ||
    buildInfo.apiProtocolVersion !== shell.apiProtocolVersion ||
    buildInfo.dataSchemaVersion !== shell.dataSchemaVersion
  ) {
    throw new Error("Packaged Shell build info does not match the signed Desktop channel");
  }
}

async function validateWslEngine(
  options: ValidationOptions,
  channel: DesktopChannel
): Promise<void> {
  const identity = channel.wslEngine;
  const manifestPath = resolve(options.directory, identity.manifest);
  const manifestBytes = await readRegularFile(manifestPath);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== identity.manifestSha256) {
    throw new Error("WSL Engine manifest digest does not match the Desktop channel");
  }
  const manifest = parseEngineManifest(JSON.parse(manifestBytes.toString("utf8")));
  if (options.allowUnsigned && !options.publicKeyPem) {
    // Local validation retains all artifact and compatibility checks below.
  } else if (!manifest.signature) {
    if (!options.allowUnsigned) throw new Error("WSL Engine is unsigned");
  } else {
    if (!options.publicKeyPem) throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required");
    if (!verifyEngineManifestSignature(manifest, options.publicKeyPem)) {
      throw new Error("WSL Engine signature is invalid");
    }
  }
  if (
    manifest.engineVersion !== channel.shell.engineVersion ||
    manifest.nodeVersion !== channel.shell.nodeVersion ||
    manifest.platform !== "linux" ||
    manifest.arch !== "x64" ||
    manifest.packageFile !== `coder-studio-engine-${channel.shell.engineVersion}-linux-x64.tgz` ||
    manifest.files.some((entry) => entry.path.endsWith(".map"))
  ) {
    throw new Error("WSL Engine is incompatible with the Desktop release boundary");
  }
  const packagePath = resolve(options.directory, manifest.packageFile);
  const packageBytes = await readRegularFile(packagePath);
  if (
    packageBytes.byteLength !== manifest.packageSize ||
    createHash("sha256").update(packageBytes).digest("hex") !== manifest.packageSha256
  ) {
    throw new Error("WSL Engine package hash or size is invalid");
  }
  const extractionRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-desktop-engine-"));
  try {
    await extractArchive(packagePath, extractionRoot);
    await assertFileEntries(extractionRoot, manifest.files, "WSL Engine archive");
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function validateWindowsEngine(directory: string): Promise<void> {
  const engineRoot = resolve(directory, "windows-engine");
  const files = await collectFiles(engineRoot);
  if (!files.includes("node.exe") || files.some((path) => path.endsWith(".map"))) {
    throw new Error("Packaged Windows Engine is missing Node or contains source maps");
  }
  for (const file of files) {
    const metadata = await lstat(resolve(engineRoot, ...file.split("/")));
    if (metadata.size <= 0 && !isAllowedEmptyWindowsEngineFile(file)) {
      throw new Error(`Packaged Windows Engine file is empty: ${file}`);
    }
  }
}

function assertFactoryProvenanceMatchesChannel(
  provenance: FactoryProductProvenance,
  channel: DesktopChannel
): void {
  if (
    JSON.stringify(provenance) !== JSON.stringify({ schemaVersion: 1, ...channel.factoryProduct })
  ) {
    throw new Error("Factory Product provenance does not match the signed Desktop channel");
  }
}

async function validateFactoryRuntime(
  options: ValidationOptions,
  channel: DesktopChannel,
  provenance: FactoryProductProvenance
): Promise<void> {
  const root = resolve(options.directory, "factory-runtime");
  const manifestPath = resolve(root, "manifest.json");
  const manifestBytes = await readRegularFile(manifestPath);
  if (
    createHash("sha256").update(manifestBytes).digest("hex") !==
    provenance.runtimes["win32-x64"].manifestSha256
  ) {
    throw new Error("Factory Runtime manifest digest does not match accepted Product provenance");
  }
  const manifest = parseNetworkRuntimeManifest(JSON.parse(manifestBytes.toString("utf8")));
  assertRuntimeSignature(manifest, options);
  if (
    manifest.runtimeVersion !== provenance.version ||
    manifest.platform !== "win32" ||
    manifest.arch !== "x64" ||
    manifest.entrypoint !== "server.mjs" ||
    manifest.webRoot !== "web"
  ) {
    throw new Error("Factory Runtime does not match the accepted Product identity");
  }
  if (
    compareVersions(manifest.minShellVersion, channel.shell.version) > 0 ||
    manifest.requiredEngineVersion !== channel.shell.engineVersion ||
    manifest.requiredNodeVersion !== channel.shell.nodeVersion ||
    manifest.runtimeHostApiVersion !== channel.shell.runtimeHostApiVersion ||
    manifest.apiProtocolVersion !== channel.shell.apiProtocolVersion ||
    manifest.dataSchemaVersion !== channel.shell.dataSchemaVersion
  ) {
    throw new Error("Factory Runtime capabilities are incompatible with the packaged Shell");
  }
  await assertFileEntries(
    root,
    [...manifest.files, { path: "manifest.json", ...(await hashRuntimeFile(manifestPath)) }],
    "Factory Runtime"
  );
}

async function assertDesktopDoesNotOwnProductArtifacts(directory: string): Promise<void> {
  const files = await collectFiles(directory);
  const productAsset = files.find(
    (path) =>
      !path.startsWith("factory-runtime/") &&
      (/^coder-studio-(?:server-)?runtime-.*\.tgz$/.test(path) ||
        path === "coder-studio-runtime-win32-x64.manifest.json" ||
        path === "coder-studio-server-runtime-linux-x64.manifest.json" ||
        path === "product-channel.json")
  );
  if (productAsset) {
    throw new Error(
      `Desktop bundle does not own Product Runtime publication asset: ${productAsset}`
    );
  }
}

export async function validateDesktopReleaseArtifacts(
  options: ValidateDesktopReleaseOptions
): Promise<void> {
  const directory = resolve(options.directory);
  const normalizedOptions = { ...options, directory };
  if (!options.publicKeyPem && !options.allowUnsigned) {
    throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required for Desktop validation");
  }
  await assertDesktopDoesNotOwnProductArtifacts(directory);
  const channel = parseDesktopChannel(
    await readJson(resolve(directory, "desktop-channel.json")),
    options.publicKeyPem ?? "",
    DESKTOP_CHANNEL_URL,
    { allowUnsigned: options.allowUnsigned && !options.publicKeyPem }
  );
  const buildInfo = parseDesktopBuildInfo(await readJson(resolve(directory, "build-info.json")));
  assertBuildInfoMatchesChannel(buildInfo, channel);
  const provenance = parseFactoryProductProvenance(
    await readJson(resolve(directory, "factory-product.json"))
  );
  assertFactoryProvenanceMatchesChannel(provenance, channel);
  info("Validating Desktop Shell and installer");
  await validateDesktopInstaller(directory, channel);
  info("Validating Desktop Windows Engine");
  await validateWindowsEngine(directory);
  info("Validating Desktop WSL Engine");
  await validateWslEngine(normalizedOptions, channel);
  info("Validating accepted Factory Runtime bytes");
  await validateFactoryRuntime(normalizedOptions, channel, provenance);
  success(`Desktop release artifacts are valid: ${directory}`);
}

async function main(): Promise<void> {
  const command = parseReleaseArtifactsCommand(process.argv.slice(2));
  if (command.action === "stage-product") await stageProductReleaseArtifacts(command);
  else if (command.action === "validate-product") await validateProductReleaseArtifacts(command);
  else if (command.action === "stage-desktop") await stageDesktopReleaseArtifacts(command);
  else await validateDesktopReleaseArtifacts(command);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((artifactError) => {
    error(
      artifactError instanceof Error
        ? artifactError.stack || artifactError.message
        : String(artifactError)
    );
    process.exit(1);
  });
}
