import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { extract } from "tar";
import {
  type DesktopBuildInfo,
  parseDesktopBuildInfo,
} from "../packages/desktop/src/build-info.js";
import {
  type DesktopChannel,
  type DesktopChannelRuntime,
  parseDesktopChannel,
} from "../packages/desktop/src/desktop-channel.js";
import {
  type EngineManifest,
  parseEngineManifest,
  verifyEngineManifestSignature,
} from "../packages/desktop/src/engine-manifest.js";
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

export type DesktopReleaseComponent = "desktop" | "win-runtime" | "wsl-engine" | "wsl-runtime";

interface ArtifactOptions {
  directory: string;
  components: DesktopReleaseComponent[];
}

export interface StageDesktopReleaseOptions extends ArtifactOptions {}

export interface ValidateDesktopReleaseOptions extends ArtifactOptions {
  allowUnsigned: boolean;
  publicKeyPem?: string;
  previousPublicKeyPem?: string;
  previousReleaseDirectory?: string;
  allowResignedEngine?: boolean;
  releaseKind?: "full" | "runtime-only" | "migration";
}

export type DesktopReleaseCommand =
  | ({ action: "stage" } & StageDesktopReleaseOptions)
  | ({ action: "validate" } & ValidateDesktopReleaseOptions);

const RELEASE_ROOT = resolve(ROOT_DIR, "release");
const COMPONENTS = new Set<DesktopReleaseComponent>([
  "desktop",
  "win-runtime",
  "wsl-engine",
  "wsl-runtime",
]);

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseComponents(value: string): DesktopReleaseComponent[] {
  const components = [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
  if (
    components.length === 0 ||
    components.some((entry) => !COMPONENTS.has(entry as DesktopReleaseComponent))
  ) {
    throw new Error(`--components must contain one or more of: ${[...COMPONENTS].join(", ")}`);
  }
  return components as DesktopReleaseComponent[];
}

export function parseDesktopReleaseCommand(argv: string[]): DesktopReleaseCommand {
  const [action, ...args] = argv;
  if (action !== "stage" && action !== "validate") {
    throw new Error("Desktop release artifacts command must be stage or validate");
  }
  let directory = "";
  let components: DesktopReleaseComponent[] = [];
  let allowUnsigned = false;
  let previousReleaseDirectory: string | undefined;
  let allowResignedEngine = false;
  let releaseKind: "full" | "runtime-only" | "migration" = "full";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--directory":
        directory = resolve(readArgumentValue(args, ++index, "--directory"));
        break;
      case "--components":
        components = parseComponents(readArgumentValue(args, ++index, "--components"));
        break;
      case "--allow-unsigned":
        allowUnsigned = true;
        break;
      case "--allow-resigned-engine":
        allowResignedEngine = true;
        break;
      case "--previous-release-directory":
        previousReleaseDirectory = resolve(
          readArgumentValue(args, ++index, "--previous-release-directory")
        );
        break;
      case "--release-kind": {
        const value = readArgumentValue(args, ++index, "--release-kind");
        if (value !== "full" && value !== "runtime-only" && value !== "migration") {
          throw new Error("--release-kind must be full, runtime-only, or migration");
        }
        releaseKind = value;
        break;
      }
      default:
        throw new Error(`Unknown desktop release artifacts option: ${argument}`);
    }
  }
  if (!directory) throw new Error("--directory is required");
  if (components.length === 0) throw new Error("--components is required");
  return action === "stage"
    ? { action, directory, components }
    : {
        action,
        directory,
        components,
        allowUnsigned,
        publicKeyPem: process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY?.trim(),
        previousPublicKeyPem: process.env.CODER_STUDIO_PREVIOUS_RUNTIME_PUBLIC_KEY?.trim(),
        previousReleaseDirectory,
        allowResignedEngine,
        releaseKind,
      };
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`);
}

function assertSafeStageDirectory(directory: string): void {
  if (!isInside(RELEASE_ROOT, directory)) {
    throw new Error(`Desktop release staging directory must be inside ${RELEASE_ROOT}`);
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

async function copyArtifact(source: string, destinationDirectory: string): Promise<void> {
  await copyFile(source, resolve(destinationDirectory, basename(source)));
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

async function stageDesktop(destinationDirectory: string): Promise<void> {
  const sourceDirectory = resolve(RELEASE_ROOT, "desktop");
  const metadataPath = resolve(sourceDirectory, "latest.yml");
  const metadata = parseUpdaterMetadata((await readRegularFile(metadataPath)).toString("utf8"));
  const files = [
    metadataPath,
    resolve(sourceDirectory, metadata.path),
    resolve(sourceDirectory, `${metadata.path}.blockmap`),
    resolve(sourceDirectory, "build-info.json"),
  ];
  for (const optional of ["desktop-channel.json"]) {
    const path = resolve(sourceDirectory, optional);
    try {
      if ((await stat(path)).isFile()) files.push(path);
    } catch {
      // The channel is built only after both platform bundles are merged.
    }
  }
  await Promise.all(files.map((path) => copyArtifact(path, destinationDirectory)));
}

export async function stageDesktopReleaseArtifacts(
  options: StageDesktopReleaseOptions
): Promise<void> {
  const directory = resolve(options.directory);
  assertSafeStageDirectory(directory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  for (const component of options.components) {
    if (component === "desktop") await stageDesktop(directory);
    if (component === "win-runtime") {
      await stageManifestArtifact(
        resolve(RELEASE_ROOT, "runtime/coder-studio-runtime-win32-x64.manifest.json"),
        resolve(RELEASE_ROOT, "runtime"),
        directory
      );
    }
    if (component === "wsl-engine") {
      await stageManifestArtifact(
        resolve(RELEASE_ROOT, "engine/coder-studio-engine-linux-x64.manifest.json"),
        resolve(RELEASE_ROOT, "engine"),
        directory
      );
    }
    if (component === "wsl-runtime") {
      await stageManifestArtifact(
        resolve(RELEASE_ROOT, "runtime/coder-studio-server-runtime-linux-x64.manifest.json"),
        resolve(RELEASE_ROOT, "runtime"),
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
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Release archive contains unsupported entry: ${entry.name}`);
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

async function assertFileEntries(root: string, entries: RuntimeFileEntry[]): Promise<void> {
  const expected = entries.map((entry) => entry.path).sort();
  const actual = await collectFiles(root);
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index])) {
    throw new Error("Release archive file set does not match its signed manifest");
  }
  for (const entry of entries) {
    const actualEntry = await hashRuntimeFile(resolve(root, ...entry.path.split("/")));
    if (actualEntry.sha256 !== entry.sha256 || actualEntry.size !== entry.size) {
      throw new Error(`Release archive verification failed: ${entry.path}`);
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

function assertRuntimeSignature(
  manifest: RuntimeManifest,
  options: ValidateDesktopReleaseOptions
): void {
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

async function validateRuntime(
  options: ValidateDesktopReleaseOptions,
  manifestFilename: string,
  expected: {
    platform: NodeJS.Platform;
    web: boolean;
    channel: DesktopChannelRuntime;
    shellVersion: string;
  }
): Promise<RuntimeManifestV2> {
  const manifestPath = resolve(options.directory, manifestFilename);
  const manifest = parseNetworkRuntimeManifest(await readJson(manifestPath));
  assertRuntimeSignature(manifest, options);
  const packagePrefix = expected.web ? "coder-studio-runtime" : "coder-studio-server-runtime";
  if (manifest.runtimeVersion !== expected.channel.version) {
    throw new Error(`${manifestFilename} version does not match the signed Desktop channel`);
  }
  if (manifest.publishedAt !== expected.channel.publishedAt) {
    throw new Error(`${manifestFilename} release time does not match the signed Desktop channel`);
  }
  if (manifest.platform !== expected.platform) {
    throw new Error(`${manifestFilename} has the wrong platform`);
  }
  if (manifest.arch !== "x64") {
    throw new Error(`${manifestFilename} has the wrong architecture; expected x64`);
  }
  if (
    manifest.entrypoint !== "server.mjs" ||
    manifest.webRoot !== (expected.web ? "web" : undefined) ||
    manifest.packageFile !==
      `${packagePrefix}-${expected.channel.version}-${expected.platform}-x64.tgz`
  ) {
    throw new Error(`${manifestFilename} is incompatible with the release boundary`);
  }
  if (compareVersions(manifest.minShellVersion, expected.shellVersion) > 0) {
    throw new Error(`${manifestFilename} minimum Shell exceeds the planned Shell`);
  }
  if (!manifest.packageFile || manifest.packageFile !== basename(manifest.packageFile)) {
    throw new Error(`${manifestFilename} has an invalid packageFile`);
  }
  if (manifest.files.some((entry) => entry.path.endsWith(".map"))) {
    throw new Error(`${manifestFilename} contains source maps`);
  }

  const extractionRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-release-runtime-"));
  try {
    const packagePath = resolve(options.directory, manifest.packageFile);
    await readRegularFile(packagePath);
    await extractArchive(packagePath, extractionRoot);
    const embeddedManifest = parseNetworkRuntimeManifest(
      await readJson(resolve(extractionRoot, "manifest.json"))
    );
    if (!signaturesMatch(manifest, embeddedManifest)) {
      throw new Error(`${manifestFilename} does not match its packaged manifest`);
    }
    await assertFileEntries(extractionRoot, [
      ...manifest.files,
      {
        path: "manifest.json",
        ...(await hashRuntimeFile(resolve(extractionRoot, "manifest.json"))),
      },
    ]);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
  return manifest;
}

async function validateEngine(
  options: ValidateDesktopReleaseOptions,
  shell: DesktopChannel["shell"]
): Promise<EngineManifest> {
  const manifestFilename = "coder-studio-engine-linux-x64.manifest.json";
  const manifest = parseEngineManifest(
    await readJson(resolve(options.directory, manifestFilename))
  );
  if (options.allowUnsigned && !options.publicKeyPem) {
    // Local smoke validation still enforces every path, hash, timestamp, and capability below.
  } else if (!manifest.signature) {
    if (!options.allowUnsigned) throw new Error("WSL Engine is unsigned");
  } else {
    if (!options.publicKeyPem) throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required");
    if (!verifyEngineManifestSignature(manifest, options.publicKeyPem)) {
      throw new Error("WSL Engine signature is invalid");
    }
  }
  if (
    manifest.engineVersion !== shell.engineVersion ||
    manifest.nodeVersion !== shell.nodeVersion ||
    manifest.platform !== "linux" ||
    manifest.arch !== "x64" ||
    manifest.packageFile !== `coder-studio-engine-${shell.engineVersion}-linux-x64.tgz` ||
    manifest.files.some((entry) => entry.path.endsWith(".map"))
  ) {
    throw new Error("WSL Engine is incompatible with the release boundary");
  }
  const packagePath = resolve(options.directory, manifest.packageFile);
  const bytes = await readRegularFile(packagePath);
  if (
    bytes.byteLength !== manifest.packageSize ||
    createHash("sha256").update(bytes).digest("hex") !== manifest.packageSha256
  ) {
    throw new Error("WSL Engine package hash or size is invalid");
  }

  const extractionRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-release-engine-"));
  try {
    await extractArchive(packagePath, extractionRoot);
    await assertFileEntries(extractionRoot, manifest.files);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
  return manifest;
}

async function validateDesktop(
  directory: string,
  desktopVersion: string,
  updaterMetadataFile = "latest.yml"
): Promise<void> {
  const metadata = parseUpdaterMetadata(
    (await readRegularFile(resolve(directory, updaterMetadataFile))).toString("utf8")
  );
  if (metadata.version !== desktopVersion) {
    throw new Error(`Desktop latest.yml version must be ${desktopVersion}`);
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
    throw new Error("Desktop installer size does not match latest.yml");
  }
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(installerPath)) hash.update(chunk);
  if (hash.digest("base64") !== metadata.sha512) {
    throw new Error("Desktop installer SHA-512 does not match latest.yml");
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

function assertRuntimeCapabilities(
  manifest: RuntimeManifestV2,
  shell: DesktopChannel["shell"],
  label: string
): void {
  if (manifest.requiredEngineVersion !== shell.engineVersion) {
    throw new Error(`${label} Engine ABI does not match the planned Shell`);
  }
  if (manifest.requiredNodeVersion !== shell.nodeVersion) {
    throw new Error(`${label} Node version does not match the planned Shell`);
  }
  if (manifest.runtimeHostApiVersion !== shell.runtimeHostApiVersion) {
    throw new Error(`${label} Runtime Host API does not match the planned Shell`);
  }
  if (manifest.apiProtocolVersion !== shell.apiProtocolVersion) {
    throw new Error(`${label} API protocol does not match the planned Shell`);
  }
  if (manifest.dataSchemaVersion !== shell.dataSchemaVersion) {
    throw new Error(`${label} data schema does not match the planned Shell`);
  }
}

function assertRuntimePairMatchesChannel(
  windows: RuntimeManifestV2,
  linux: RuntimeManifestV2,
  channel: DesktopChannel
): void {
  if (windows.runtimeVersion !== linux.runtimeVersion) {
    throw new Error("Windows and WSL Runtimes must use the same product version");
  }
  const sharedFields = [
    "publishedAt",
    "minShellVersion",
    "requiredEngineVersion",
    "requiredNodeVersion",
    "runtimeHostApiVersion",
    "apiProtocolVersion",
    "dataSchemaVersion",
  ] as const;
  if (sharedFields.some((field) => windows[field] !== linux[field])) {
    throw new Error("Windows and WSL Runtime pair has mismatched shared capabilities");
  }
  assertRuntimeCapabilities(windows, channel.shell, "Windows Runtime");
  assertRuntimeCapabilities(linux, channel.shell, "WSL Runtime");
}

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readRegularFile(path))
    .digest("hex");
}

async function readSignedChannel(
  directory: string,
  publicKeyPem: string,
  filename = "desktop-channel.json"
): Promise<DesktopChannel> {
  return parseDesktopChannel(
    await readJson(resolve(directory, filename)),
    publicKeyPem,
    pathToFileURL(resolve(directory, filename)).toString()
  );
}

async function readPreviousRuntimePair(
  directory: string,
  channel: DesktopChannel,
  publicKeyPem: string
): Promise<[RuntimeManifestV2, RuntimeManifestV2]> {
  const windows = parseNetworkRuntimeManifest(
    await readJson(resolve(directory, channel.runtimes["win32-x64"].manifest))
  );
  const linux = parseNetworkRuntimeManifest(
    await readJson(resolve(directory, channel.runtimes["linux-x64"].manifest))
  );
  for (const manifest of [windows, linux]) {
    if (!verifyRuntimeManifestSignature(manifest, publicKeyPem)) {
      throw new Error("Previous unified channel has an invalid Runtime signature");
    }
  }
  return [windows, linux];
}

async function assertTargetShellRunsPreviousRuntime(
  targetChannel: DesktopChannel,
  previousDirectory: string,
  publicKeyPem: string
): Promise<void> {
  const previousChannel = await readSignedChannel(previousDirectory, publicKeyPem);
  const [windows, linux] = await readPreviousRuntimePair(
    previousDirectory,
    previousChannel,
    publicKeyPem
  );
  for (const [label, manifest] of [
    ["previous Windows Runtime", windows],
    ["previous WSL Runtime", linux],
  ] as const) {
    if (compareVersions(manifest.minShellVersion, targetChannel.shell.version) > 0) {
      throw new Error(`Target Shell cannot run the ${label}`);
    }
    assertRuntimeCapabilities(manifest, targetChannel.shell, label);
  }
}

async function validateRuntimeOnlyCarryForward(
  options: ValidateDesktopReleaseOptions & { directory: string; publicKeyPem?: string },
  channel: DesktopChannel,
  previousDirectory: string
): Promise<void> {
  if (!options.publicKeyPem) {
    throw new Error("Runtime-only release requires the Desktop channel public key");
  }
  const previousPublicKeyPem = options.previousPublicKeyPem ?? options.publicKeyPem;
  const previousChannel = await readSignedChannel(previousDirectory, previousPublicKeyPem);
  if (JSON.stringify(previousChannel.shell) !== JSON.stringify(channel.shell)) {
    throw new Error("Runtime-only release changed Shell or host capability metadata");
  }
  const previousUpdater = parseUpdaterMetadata(
    (await readRegularFile(resolve(previousDirectory, "latest.yml"))).toString("utf8")
  );
  const previousEngine = options.allowResignedEngine
    ? null
    : parseEngineManifest(
        await readJson(resolve(previousDirectory, "coder-studio-engine-linux-x64.manifest.json"))
      );
  const carriedFiles = [
    "latest.yml",
    previousUpdater.path,
    `${previousUpdater.path}.blockmap`,
    "build-info.json",
    ...(previousEngine
      ? ["coder-studio-engine-linux-x64.manifest.json", previousEngine.packageFile]
      : []),
  ];
  for (const filename of carriedFiles) {
    const [previousHash, currentHash] = await Promise.all([
      fileSha256(resolve(previousDirectory, filename)),
      fileSha256(resolve(options.directory, filename)),
    ]);
    if (previousHash !== currentHash) {
      throw new Error(`Runtime-only release changed carried-forward asset: ${filename}`);
    }
  }
  await assertTargetShellRunsPreviousRuntime(channel, previousDirectory, previousPublicKeyPem);
}

async function validateModernRuntimeOnlyCarryForward(
  options: ValidateDesktopReleaseOptions & { directory: string; publicKeyPem: string },
  legacyChannel: DesktopChannel,
  windows: RuntimeManifestV2,
  linux: RuntimeManifestV2,
  previousDirectory: string
): Promise<void> {
  const previousPublicKeyPem = options.previousPublicKeyPem ?? options.publicKeyPem;
  const [modern, previousModern] = await Promise.all([
    readSignedChannel(options.directory, options.publicKeyPem, "desktop-channel-modern.json"),
    readSignedChannel(previousDirectory, previousPublicKeyPem, "desktop-channel-modern.json"),
  ]);
  if (modern.shell.updaterMetadata !== "modern.yml") {
    throw new Error("Modern Runtime-only channel must use modern.yml");
  }
  if (JSON.stringify(modern.shell) !== JSON.stringify(previousModern.shell)) {
    throw new Error("Runtime-only release changed the modern Shell metadata");
  }
  if (JSON.stringify(modern.runtimes) !== JSON.stringify(legacyChannel.runtimes)) {
    throw new Error("Legacy and modern Runtime-only channels must publish the same Runtime pair");
  }
  const previousUpdater = parseUpdaterMetadata(
    (await readRegularFile(resolve(previousDirectory, "modern.yml"))).toString("utf8")
  );
  for (const filename of [
    "modern.yml",
    previousUpdater.path,
    `${previousUpdater.path}.blockmap`,
    "build-info-modern.json",
  ]) {
    const [previousHash, currentHash] = await Promise.all([
      fileSha256(resolve(previousDirectory, filename)),
      fileSha256(resolve(options.directory, filename)),
    ]);
    if (previousHash !== currentHash) {
      throw new Error(`Runtime-only release changed carried-forward modern asset: ${filename}`);
    }
  }
  const modernBuildInfo = parseDesktopBuildInfo(
    await readJson(resolve(options.directory, "build-info-modern.json"))
  );
  assertBuildInfoMatchesChannel(modernBuildInfo, modern);
  await validateDesktop(options.directory, modern.shell.version, "modern.yml");
  assertRuntimePairMatchesChannel(windows, linux, modern);
  await validateEngine(options, modern.shell);
  await assertTargetShellRunsPreviousRuntime(modern, previousDirectory, previousPublicKeyPem);
}

async function validateModernMigrationChannel(
  options: ValidateDesktopReleaseOptions & { directory: string; publicKeyPem: string },
  legacyChannel: DesktopChannel,
  windows: RuntimeManifestV2,
  linux: RuntimeManifestV2,
  previousDirectory: string
): Promise<void> {
  const previousPublicKeyPem = options.previousPublicKeyPem ?? options.publicKeyPem;
  const modern = await readSignedChannel(
    options.directory,
    options.publicKeyPem,
    "desktop-channel-modern.json"
  );
  if (legacyChannel.shell.updaterMetadata !== "latest.yml") {
    throw new Error("Legacy migration channel must use latest.yml");
  }
  if (modern.shell.updaterMetadata !== "modern.yml") {
    throw new Error("Modern migration channel must use modern.yml");
  }
  if (compareVersions(modern.shell.version, legacyChannel.shell.version) <= 0) {
    throw new Error("Modern migration Shell must be newer than the legacy Shell");
  }
  if (JSON.stringify(modern.runtimes) !== JSON.stringify(legacyChannel.runtimes)) {
    throw new Error("Legacy and modern migration channels must publish the same Runtime pair");
  }
  const modernBuildInfo = parseDesktopBuildInfo(
    await readJson(resolve(options.directory, "build-info-modern.json"))
  );
  assertBuildInfoMatchesChannel(modernBuildInfo, modern);
  await validateDesktop(options.directory, modern.shell.version, "modern.yml");
  assertRuntimePairMatchesChannel(windows, linux, modern);
  await validateEngine(options, modern.shell);
  await assertTargetShellRunsPreviousRuntime(modern, previousDirectory, previousPublicKeyPem);
}

export async function validateDesktopReleaseArtifacts(
  options: ValidateDesktopReleaseOptions
): Promise<void> {
  const directory = resolve(options.directory);
  const requiredComponents = ["desktop", "win-runtime", "wsl-engine", "wsl-runtime"] as const;
  if (requiredComponents.some((component) => !options.components.includes(component))) {
    throw new Error("Unified Desktop release validation requires every release component");
  }
  if (!options.publicKeyPem && !options.allowUnsigned) {
    throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required for the signed Desktop channel");
  }
  const normalizedOptions = { ...options, directory };
  const channel = parseDesktopChannel(
    await readJson(resolve(directory, "desktop-channel.json")),
    options.publicKeyPem ?? "",
    pathToFileURL(resolve(directory, "desktop-channel.json")).toString(),
    { allowUnsigned: options.allowUnsigned && !options.publicKeyPem }
  );
  const buildInfo = parseDesktopBuildInfo(await readJson(resolve(directory, "build-info.json")));
  assertBuildInfoMatchesChannel(buildInfo, channel);

  info("Validating Desktop release component: desktop");
  await validateDesktop(directory, channel.shell.version);
  info("Validating Desktop release component: win-runtime");
  const windows = await validateRuntime(normalizedOptions, channel.runtimes["win32-x64"].manifest, {
    platform: "win32",
    web: true,
    channel: channel.runtimes["win32-x64"],
    shellVersion: channel.shell.version,
  });
  info("Validating Desktop release component: wsl-runtime");
  const linux = await validateRuntime(normalizedOptions, channel.runtimes["linux-x64"].manifest, {
    platform: "linux",
    web: false,
    channel: channel.runtimes["linux-x64"],
    shellVersion: channel.shell.version,
  });
  assertRuntimePairMatchesChannel(windows, linux, channel);
  info("Validating Desktop release component: wsl-engine");
  await validateEngine(normalizedOptions, channel.shell);

  const releaseKind = options.releaseKind ?? "full";
  if (releaseKind === "runtime-only") {
    if (!options.previousReleaseDirectory || !options.publicKeyPem) {
      throw new Error("Runtime-only release requires a previous signed unified channel");
    }
    const previousDirectory = resolve(options.previousReleaseDirectory);
    await validateRuntimeOnlyCarryForward(normalizedOptions, channel, previousDirectory);
    await validateModernRuntimeOnlyCarryForward(
      { ...normalizedOptions, publicKeyPem: options.publicKeyPem },
      channel,
      windows,
      linux,
      previousDirectory
    );
  } else if (releaseKind === "migration") {
    if (!options.previousReleaseDirectory || !options.publicKeyPem) {
      throw new Error("Migration release requires a previous signed unified channel");
    }
    const previousDirectory = resolve(options.previousReleaseDirectory);
    await validateRuntimeOnlyCarryForward(normalizedOptions, channel, previousDirectory);
    await validateModernMigrationChannel(
      { ...normalizedOptions, publicKeyPem: options.publicKeyPem },
      channel,
      windows,
      linux,
      previousDirectory
    );
  } else if (options.previousReleaseDirectory) {
    await assertTargetShellRunsPreviousRuntime(
      channel,
      resolve(options.previousReleaseDirectory),
      options.previousPublicKeyPem ?? options.publicKeyPem
    );
  }
  success(`Desktop release artifacts are valid: ${directory}`);
}

async function main(): Promise<void> {
  const command = parseDesktopReleaseCommand(process.argv.slice(2));
  if (command.action === "stage") await stageDesktopReleaseArtifacts(command);
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
