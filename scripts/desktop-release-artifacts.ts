import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { extract } from "tar";
import {
  parseEngineManifest,
  verifyEngineManifestSignature,
} from "../packages/desktop/src/engine-manifest.js";
import {
  API_PROTOCOL_VERSION,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  DESKTOP_NODE_VERSION,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  isSafeRuntimeRelativePath,
  parseRuntimeManifest,
  RUNTIME_HOST_API_VERSION,
  type RuntimeFileEntry,
  type RuntimeManifest,
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

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
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
  const metadata = parseUpdaterMetadata(await readFile(metadataPath, "utf8"));
  await Promise.all(
    [
      metadataPath,
      resolve(sourceDirectory, metadata.path),
      resolve(sourceDirectory, `${metadata.path}.blockmap`),
    ].map((path) => copyArtifact(path, destinationDirectory))
  );
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
    packageFile: string;
    runtimeVersion: string;
    shellVersion: string;
  }
): Promise<void> {
  const manifestPath = resolve(options.directory, manifestFilename);
  const manifest = parseRuntimeManifest(await readJson(manifestPath));
  assertRuntimeSignature(manifest, options);
  if (
    manifest.platform !== expected.platform ||
    manifest.arch !== "x64" ||
    manifest.runtimeVersion !== expected.runtimeVersion ||
    manifest.minShellVersion !== expected.shellVersion ||
    manifest.requiredEngineVersion !== DESKTOP_ENGINE_VERSION ||
    manifest.requiredNodeVersion !== DESKTOP_NODE_VERSION ||
    manifest.runtimeHostApiVersion !== RUNTIME_HOST_API_VERSION ||
    manifest.apiProtocolVersion !== API_PROTOCOL_VERSION ||
    manifest.dataSchemaVersion !== DATA_SCHEMA_VERSION ||
    manifest.entrypoint !== "server.mjs" ||
    manifest.webRoot !== (expected.web ? "web" : undefined) ||
    manifest.packageFile !== expected.packageFile
  ) {
    throw new Error(`${manifestFilename} is incompatible with the release boundary`);
  }
  if (!manifest.packageFile || manifest.packageFile !== basename(manifest.packageFile)) {
    throw new Error(`${manifestFilename} has an invalid packageFile`);
  }
  if (manifest.files.some((entry) => entry.path.endsWith(".map"))) {
    throw new Error(`${manifestFilename} contains source maps`);
  }

  const extractionRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-release-runtime-"));
  try {
    await extractArchive(resolve(options.directory, manifest.packageFile), extractionRoot);
    const embeddedManifest = parseRuntimeManifest(
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
}

async function validateEngine(options: ValidateDesktopReleaseOptions): Promise<void> {
  const manifestFilename = "coder-studio-engine-linux-x64.manifest.json";
  const manifest = parseEngineManifest(
    await readJson(resolve(options.directory, manifestFilename))
  );
  if (!manifest.signature) {
    if (!options.allowUnsigned) throw new Error("WSL Engine is unsigned");
  } else {
    if (!options.publicKeyPem) throw new Error("CODER_STUDIO_RUNTIME_PUBLIC_KEY is required");
    if (!verifyEngineManifestSignature(manifest, options.publicKeyPem)) {
      throw new Error("WSL Engine signature is invalid");
    }
  }
  if (
    manifest.engineVersion !== DESKTOP_ENGINE_VERSION ||
    manifest.nodeVersion !== DESKTOP_NODE_VERSION ||
    manifest.platform !== "linux" ||
    manifest.arch !== "x64" ||
    manifest.packageFile !== `coder-studio-engine-${DESKTOP_ENGINE_VERSION}-linux-x64.tgz` ||
    manifest.files.some((entry) => entry.path.endsWith(".map"))
  ) {
    throw new Error("WSL Engine is incompatible with the release boundary");
  }
  const packagePath = resolve(options.directory, manifest.packageFile);
  const bytes = await readFile(packagePath);
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
}

async function readPackageVersion(path: string): Promise<string> {
  const manifest = (await readJson(path)) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`Package version is missing: ${path}`);
  }
  return manifest.version.trim();
}

async function validateDesktop(directory: string, desktopVersion: string): Promise<void> {
  const metadata = parseUpdaterMetadata(await readFile(resolve(directory, "latest.yml"), "utf8"));
  if (metadata.version !== desktopVersion) {
    throw new Error(`Desktop latest.yml version must be ${desktopVersion}`);
  }
  const installerPath = resolve(directory, metadata.path);
  const [installer, blockmap] = await Promise.all([
    stat(installerPath),
    stat(resolve(directory, `${metadata.path}.blockmap`)),
  ]);
  if (!installer.isFile() || installer.size <= 0 || !blockmap.isFile() || blockmap.size <= 0) {
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

export async function validateDesktopReleaseArtifacts(
  options: ValidateDesktopReleaseOptions
): Promise<void> {
  const directory = resolve(options.directory);
  const [desktopVersion, runtimeVersion] = await Promise.all([
    readPackageVersion(resolve(ROOT_DIR, "packages/desktop/package.json")),
    readPackageVersion(resolve(ROOT_DIR, "packages/cli/package.json")),
  ]);
  const normalizedOptions = { ...options, directory };
  for (const component of options.components) {
    info(`Validating Desktop release component: ${component}`);
    if (component === "desktop") await validateDesktop(directory, desktopVersion);
    if (component === "win-runtime") {
      await validateRuntime(normalizedOptions, "coder-studio-runtime-win32-x64.manifest.json", {
        platform: "win32",
        web: true,
        packageFile: `coder-studio-runtime-${runtimeVersion}-win32-x64.tgz`,
        runtimeVersion,
        shellVersion: desktopVersion,
      });
    }
    if (component === "wsl-engine") await validateEngine(normalizedOptions);
    if (component === "wsl-runtime") {
      await validateRuntime(
        normalizedOptions,
        "coder-studio-server-runtime-linux-x64.manifest.json",
        {
          platform: "linux",
          web: false,
          packageFile: `coder-studio-server-runtime-${runtimeVersion}-linux-x64.tgz`,
          runtimeVersion,
          shellVersion: desktopVersion,
        }
      );
    }
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
