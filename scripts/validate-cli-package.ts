import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { list, type ReadEntry } from "tar";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const PACKAGE_MANIFEST_PATH = "package/package.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const ENTRY_PREFIX_BYTES = 128;
const PUBLISH_ENTRY_FIELDS = ["main", "types", "typings", "bin", "exports"] as const;

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  main?: unknown;
  types?: unknown;
  typings?: unknown;
  bin?: unknown;
  exports?: unknown;
  publishConfig?: unknown;
}

interface ArchiveEntry {
  prefix: Buffer;
  type: string;
}

interface PackageEntryTarget {
  archivePath: string;
  field: string;
  isBin: boolean;
  target: string;
}

export interface ValidateCliPackageInput {
  compareTarballPath?: string;
  sourcePackageJsonPath: string;
  tarballPath: string;
}

export interface ValidatedCliPackage {
  entryTargets: string[];
  name: string;
  version: string;
}

interface ArchiveContentEntry {
  digest: string;
  executable: boolean;
  linkpath: string;
  size: number;
  type: string;
}

export async function validateCliPackageArchive({
  sourcePackageJsonPath,
  tarballPath,
}: ValidateCliPackageInput): Promise<ValidatedCliPackage> {
  const sourceManifest = JSON.parse(
    await readFile(sourcePackageJsonPath, "utf8")
  ) as PackageManifest;
  const archiveEntries = await readArchiveEntries(tarballPath);
  const packedManifestEntry = archiveEntries.get(PACKAGE_MANIFEST_PATH);

  if (!packedManifestEntry || packedManifestEntry.type !== "File") {
    throw new Error(`Packed CLI is missing ${PACKAGE_MANIFEST_PATH}`);
  }

  const packedManifest = parsePackedManifest(packedManifestEntry.prefix, tarballPath);
  assertPublishConfigApplied(sourceManifest, packedManifest);

  if (typeof packedManifest.name !== "string" || packedManifest.name.length === 0) {
    throw new Error("Packed CLI package.json is missing name");
  }
  if (typeof packedManifest.version !== "string" || packedManifest.version.length === 0) {
    throw new Error("Packed CLI package.json is missing version");
  }

  const targets = collectPackageEntryTargets(packedManifest);
  if (targets.length === 0) {
    throw new Error("Packed CLI package.json does not declare any package entry files");
  }

  for (const target of targets) {
    const entry = archiveEntries.get(target.archivePath);
    if (!entry) {
      throw new Error(
        `Packed CLI ${target.field} points to missing file ${JSON.stringify(target.target)}`
      );
    }
    if (entry.type !== "File") {
      throw new Error(
        `Packed CLI ${target.field} must point to a regular file, got ${entry.type}: ${JSON.stringify(target.target)}`
      );
    }
    if (target.isBin && !hasNodeShebang(entry.prefix)) {
      throw new Error(
        `Packed CLI ${target.field} is not an executable Node.js entry: ${JSON.stringify(target.target)}`
      );
    }
  }

  return {
    entryTargets: Array.from(new Set(targets.map((target) => target.target))).sort(),
    name: packedManifest.name,
    version: packedManifest.version,
  };
}

export async function compareCliPackageArchives(
  candidateTarballPath: string,
  publishedTarballPath: string
): Promise<void> {
  const [candidateEntries, publishedEntries] = await Promise.all([
    readArchiveContentEntries(candidateTarballPath),
    readArchiveContentEntries(publishedTarballPath),
  ]);
  const candidatePaths = [...candidateEntries.keys()].sort();
  const publishedPaths = [...publishedEntries.keys()].sort();
  if (!isDeepStrictEqual(candidatePaths, publishedPaths)) {
    const candidateOnly = candidatePaths.filter((path) => !publishedEntries.has(path));
    const publishedOnly = publishedPaths.filter((path) => !candidateEntries.has(path));
    throw new Error(
      `Packed CLI contents differ; candidate-only: ${candidateOnly.join(", ") || "none"}; published-only: ${publishedOnly.join(", ") || "none"}`
    );
  }

  for (const path of candidatePaths) {
    if (!isDeepStrictEqual(candidateEntries.get(path), publishedEntries.get(path))) {
      throw new Error(`Packed CLI contents differ at ${path}`);
    }
  }
}

async function readArchiveContentEntries(
  tarballPath: string
): Promise<Map<string, ArchiveContentEntry>> {
  const entries = new Map<string, ArchiveContentEntry>();
  const seen = new Set<string>();
  const reads: Promise<void>[] = [];

  await list({
    file: tarballPath,
    strict: true,
    onReadEntry(entry) {
      if (entry.type === "Directory") {
        entry.resume();
        return;
      }
      const archivePath = normalizeArchivePath(entry.path);
      if (seen.has(archivePath)) {
        throw new Error(`Packed CLI contains duplicate archive path: ${archivePath}`);
      }
      seen.add(archivePath);
      reads.push(
        readEntryContent(entry).then((content) => {
          entries.set(archivePath, content);
        })
      );
    },
  });
  await Promise.all(reads);
  return entries;
}

function readEntryContent(entry: ReadEntry): Promise<ArchiveContentEntry> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    let size = 0;
    entry.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      size += buffer.length;
    });
    entry.on("end", () =>
      resolve({
        digest: hash.digest("base64"),
        executable: ((entry.mode ?? 0) & 0o111) !== 0,
        linkpath: entry.linkpath ?? "",
        size,
        type: entry.type,
      })
    );
    entry.on("error", reject);
  });
}

async function readArchiveEntries(tarballPath: string): Promise<Map<string, ArchiveEntry>> {
  const entries = new Map<string, ArchiveEntry>();
  const reads: Promise<void>[] = [];

  await list({
    file: tarballPath,
    strict: true,
    onReadEntry(entry) {
      const archivePath = normalizeArchivePath(entry.path);
      const limit = archivePath === PACKAGE_MANIFEST_PATH ? MAX_MANIFEST_BYTES : ENTRY_PREFIX_BYTES;
      reads.push(
        readEntryPrefix(entry, limit).then((prefix) => {
          entries.set(archivePath, { prefix, type: entry.type });
        })
      );
    },
  });
  await Promise.all(reads);

  return entries;
}

function readEntryPrefix(entry: ReadEntry, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let captured = 0;

    entry.on("data", (chunk: Buffer | string) => {
      if (captured >= limit) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const slice = buffer.subarray(0, limit - captured);
      chunks.push(slice);
      captured += slice.length;
    });
    entry.on("end", () => resolve(Buffer.concat(chunks)));
    entry.on("error", reject);
  });
}

function normalizeArchivePath(path: string): string {
  return path.replace(/^\.\//, "").replaceAll("\\", "/");
}

function parsePackedManifest(content: Buffer, tarballPath: string): PackageManifest {
  if (content.length === MAX_MANIFEST_BYTES) {
    throw new Error(`Packed CLI package.json exceeds ${MAX_MANIFEST_BYTES} bytes: ${tarballPath}`);
  }

  try {
    return JSON.parse(content.toString("utf8")) as PackageManifest;
  } catch (cause) {
    throw new Error(`Packed CLI package.json is invalid JSON: ${tarballPath}`, { cause });
  }
}

function assertPublishConfigApplied(
  sourceManifest: PackageManifest,
  packedManifest: PackageManifest
): void {
  if (packedManifest.publishConfig !== undefined) {
    throw new Error("Packed CLI package.json still contains publishConfig");
  }

  if (
    sourceManifest.name !== packedManifest.name ||
    sourceManifest.version !== packedManifest.version
  ) {
    throw new Error("Packed CLI package identity does not match the source package.json");
  }

  const publishConfig = isRecord(sourceManifest.publishConfig)
    ? sourceManifest.publishConfig
    : undefined;

  for (const field of PUBLISH_ENTRY_FIELDS) {
    const expected =
      publishConfig && field in publishConfig ? publishConfig[field] : sourceManifest[field];
    if (!isDeepStrictEqual(packedManifest[field], expected)) {
      throw new Error(`Packed CLI package.json ${field} does not match the publish configuration`);
    }
  }
}

function collectPackageEntryTargets(manifest: PackageManifest): PackageEntryTarget[] {
  const targets: PackageEntryTarget[] = [];

  addStringTarget(targets, "main", manifest.main, false);
  addStringTarget(targets, "types", manifest.types, false);
  addStringTarget(targets, "typings", manifest.typings, false);

  if (typeof manifest.bin === "string") {
    addStringTarget(targets, "bin", manifest.bin, true);
  } else if (isRecord(manifest.bin)) {
    for (const [name, target] of Object.entries(manifest.bin)) {
      addStringTarget(targets, `bin.${name}`, target, true);
    }
  } else if (manifest.bin !== undefined) {
    throw new Error("Packed CLI package.json bin must be a string or object");
  }

  collectExportTargets(manifest.exports, "exports", targets);
  return targets;
}

function collectExportTargets(value: unknown, field: string, targets: PackageEntryTarget[]): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === "string") {
    addStringTarget(targets, field, value, false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectExportTargets(item, `${field}[${index}]`, targets));
    return;
  }
  if (isRecord(value)) {
    for (const [key, target] of Object.entries(value)) {
      collectExportTargets(target, `${field}.${key}`, targets);
    }
    return;
  }
  throw new Error(`Packed CLI package.json ${field} contains an invalid export target`);
}

function addStringTarget(
  targets: PackageEntryTarget[],
  field: string,
  value: unknown,
  isBin: boolean
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`Packed CLI package.json ${field} must be a string`);
  }
  if (!value.startsWith("./") || value.includes("\\") || value.includes("*")) {
    throw new Error(
      `Packed CLI package.json ${field} must point to one explicit package-relative file: ${JSON.stringify(value)}`
    );
  }

  const relativePath = value.slice(2);
  const segments = relativePath.split("/");
  if (relativePath.length === 0 || segments.some((segment) => segment === "" || segment === "..")) {
    throw new Error(
      `Packed CLI package.json ${field} has an unsafe target: ${JSON.stringify(value)}`
    );
  }

  targets.push({
    archivePath: `package/${relativePath}`,
    field,
    isBin,
    target: value,
  });
}

function hasNodeShebang(content: Buffer): boolean {
  const firstLine = content.toString("utf8").split(/\r?\n/, 1)[0];
  return firstLine === "#!/usr/bin/env node";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseValidateCliPackageArguments(argv: string[]): ValidateCliPackageInput {
  let compareTarballPath: string | undefined;
  let tarballPath: string | undefined;
  let sourcePackageJsonPath: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--tarball") {
      tarballPath = argv[++index];
    } else if (argument === "--compare-tarball") {
      compareTarballPath = argv[++index];
    } else if (argument === "--source-package-json") {
      sourcePackageJsonPath = argv[++index];
    } else {
      throw new Error(`Unknown validate-cli-package option: ${argument}`);
    }
  }

  if (!tarballPath || !sourcePackageJsonPath) {
    throw new Error("Usage: validate-cli-package --tarball <file> --source-package-json <file>");
  }

  return {
    ...(compareTarballPath ? { compareTarballPath } : {}),
    sourcePackageJsonPath,
    tarballPath,
  };
}

if (isDirectExecution(import.meta.url)) {
  const input = parseValidateCliPackageArguments(process.argv.slice(2));
  validateCliPackageArchive(input)
    .then(async (result) => {
      if (input.compareTarballPath) {
        await validateCliPackageArchive({
          sourcePackageJsonPath: input.sourcePackageJsonPath,
          tarballPath: input.compareTarballPath,
        });
        await compareCliPackageArchives(input.tarballPath, input.compareTarballPath);
      }
      success(
        `Validated ${result.name}@${result.version} package entry files: ${result.entryTargets.join(", ")}`
      );
    })
    .catch((cause) => {
      error(cause instanceof Error ? cause.message : String(cause));
      process.exit(1);
    });
}
