import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

export const RUNTIME_MANIFEST_SCHEMA_VERSION = 2;
export const DESKTOP_ENGINE_VERSION = "2";
export const DESKTOP_NODE_VERSION = "24.19.0";
export const RUNTIME_HOST_API_VERSION = 1;
export const API_PROTOCOL_VERSION = 1;
export const DATA_SCHEMA_VERSION = 1;

export interface RuntimeFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface RuntimeSignature {
  algorithm: "ed25519";
  value: string;
}

interface RuntimeManifestFields {
  runtimeVersion: string;
  minShellVersion: string;
  requiredEngineVersion: string;
  requiredNodeVersion: string;
  runtimeHostApiVersion: number;
  apiProtocolVersion: number;
  dataSchemaVersion: number;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  entrypoint: string;
  webRoot?: string;
  packageFile?: string;
  files: RuntimeFileEntry[];
  signature?: RuntimeSignature;
}

export interface RuntimeManifestV1 extends RuntimeManifestFields {
  schemaVersion: 1;
}

export interface RuntimeManifestV2 extends RuntimeManifestFields {
  schemaVersion: 2;
  publishedAt: string;
}

export type RuntimeManifest = RuntimeManifestV1 | RuntimeManifestV2;

export function getRuntimeManifestSigningPayload(manifest: RuntimeManifest): Buffer {
  return canonicalSigningPayload(manifest);
}

export function verifyRuntimeManifestSignature(
  manifest: RuntimeManifest,
  publicKeyPem: string
): boolean {
  return verifyEd25519Payload(
    getRuntimeManifestSigningPayload(manifest),
    manifest.signature,
    publicKeyPem
  );
}

export function getRuntimePublishedAt(manifest: RuntimeManifest): string | null {
  return manifest.schemaVersion === 2 ? manifest.publishedAt : null;
}

export function isSafeRuntimeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function resolveRuntimeFile(root: string, relativePath: string): string {
  if (!isSafeRuntimeRelativePath(relativePath)) {
    throw new Error(`Unsafe runtime file path: ${relativePath}`);
  }
  const resolvedRoot = resolve(root);
  const resolvedFile = resolve(root, ...relativePath.split("/"));
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Runtime file escaped its root: ${relativePath}`);
  }
  return resolvedFile;
}

function parseRuntimeManifestShape(
  value: unknown,
  options: { requireV2: boolean }
): RuntimeManifest {
  if (!value || typeof value !== "object") throw new Error("Runtime manifest must be an object");
  const manifest = value as Partial<RuntimeManifestFields> & {
    schemaVersion?: unknown;
    publishedAt?: unknown;
  };
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) {
    throw new Error(`Unsupported runtime manifest schema: ${String(manifest.schemaVersion)}`);
  }
  if (options.requireV2 && manifest.schemaVersion !== 2) {
    throw new Error("Network runtime manifest must use schema 2");
  }
  if (manifest.schemaVersion === 2) {
    const publishedAtTimestamp =
      typeof manifest.publishedAt === "string" ? Date.parse(manifest.publishedAt) : Number.NaN;
    if (
      typeof manifest.publishedAt !== "string" ||
      !manifest.publishedAt ||
      !Number.isFinite(publishedAtTimestamp) ||
      new Date(publishedAtTimestamp).toISOString() !== manifest.publishedAt
    ) {
      throw new Error("Runtime manifest publishedAt must be a canonical UTC timestamp");
    }
  }
  const stringFields = [
    "runtimeVersion",
    "minShellVersion",
    "requiredEngineVersion",
    "requiredNodeVersion",
    "platform",
    "arch",
    "entrypoint",
  ] as const;
  for (const field of stringFields) {
    if (typeof manifest[field] !== "string" || !(manifest[field] as string).trim()) {
      throw new Error(`Runtime manifest field ${field} must be a non-empty string`);
    }
  }
  for (const field of [
    "runtimeHostApiVersion",
    "apiProtocolVersion",
    "dataSchemaVersion",
  ] as const) {
    if (!Number.isInteger(manifest[field]) || (manifest[field] as number) < 1) {
      throw new Error(`Runtime manifest field ${field} must be a positive integer`);
    }
  }
  if (!isSafeRuntimeRelativePath(manifest.entrypoint as string)) {
    throw new Error("Runtime manifest entrypoint is unsafe");
  }
  if (manifest.webRoot !== undefined && !isSafeRuntimeRelativePath(manifest.webRoot)) {
    throw new Error("Runtime manifest webRoot is unsafe");
  }
  if (
    manifest.packageFile !== undefined &&
    (!isSafeRuntimeRelativePath(manifest.packageFile) || manifest.packageFile.includes("/"))
  ) {
    throw new Error("Runtime manifest packageFile is unsafe");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Runtime manifest must contain files");
  }
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      !isSafeRuntimeRelativePath(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      throw new Error("Runtime manifest contains an invalid file entry");
    }
    if (paths.has(file.path)) throw new Error(`Duplicate runtime file: ${file.path}`);
    paths.add(file.path);
  }
  if (!paths.has(manifest.entrypoint as string))
    throw new Error("Runtime entrypoint is not hashed");
  return manifest as RuntimeManifest;
}

export function parseInstalledRuntimeManifest(value: unknown): RuntimeManifest {
  return parseRuntimeManifestShape(value, { requireV2: false });
}

export function parseNetworkRuntimeManifest(value: unknown): RuntimeManifestV2 {
  return parseRuntimeManifestShape(value, { requireV2: true }) as RuntimeManifestV2;
}

/** @deprecated Use the installed or network parser explicitly at trust boundaries. */
export const parseRuntimeManifest = parseInstalledRuntimeManifest;

export async function readRuntimeManifest(runtimeRoot: string): Promise<RuntimeManifest> {
  return parseInstalledRuntimeManifest(
    JSON.parse(await readFile(resolveRuntimeFile(runtimeRoot, "manifest.json"), "utf8"))
  );
}

export async function hashRuntimeFile(path: string): Promise<{ sha256: string; size: number }> {
  const bytes = await readFile(path);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

interface ParsedSemanticVersion {
  core: [bigint, bigint, bigint];
  prerelease: string[] | null;
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value
    );
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? null;
  if (prerelease?.some((identifier) => /^\d+$/.test(identifier) && /^0\d+/.test(identifier))) {
    return null;
  }
  return {
    core: [BigInt(match[1] ?? 0), BigInt(match[2] ?? 0), BigInt(match[3] ?? 0)],
    prerelease,
  };
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftVersion.core[index] ?? 0n;
    const rightPart = rightVersion.core[index] ?? 0n;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  const leftPrerelease = leftVersion.prerelease;
  const rightPrerelease = rightVersion.prerelease;
  if (!leftPrerelease || !rightPrerelease) {
    if (!leftPrerelease && !rightPrerelease) return 0;
    return leftPrerelease ? -1 : 1;
  }
  const length = Math.max(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}
