import { createHash, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const RUNTIME_MANIFEST_SCHEMA_VERSION = 1;
export const DESKTOP_ENGINE_VERSION = "1";
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

export interface RuntimeManifest {
  schemaVersion: 1;
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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

export function getRuntimeManifestSigningPayload(manifest: RuntimeManifest): Buffer {
  const { signature: _signature, ...unsignedManifest } = manifest;
  return Buffer.from(canonicalize(unsignedManifest as unknown as JsonValue), "utf8");
}

export function verifyRuntimeManifestSignature(
  manifest: RuntimeManifest,
  publicKeyPem: string
): boolean {
  if (manifest.signature?.algorithm !== "ed25519" || !manifest.signature.value) return false;
  try {
    return verify(
      null,
      getRuntimeManifestSigningPayload(manifest),
      publicKeyPem,
      Buffer.from(manifest.signature.value, "base64")
    );
  } catch {
    return false;
  }
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

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  if (!value || typeof value !== "object") throw new Error("Runtime manifest must be an object");
  const manifest = value as Partial<RuntimeManifest>;
  if (manifest.schemaVersion !== RUNTIME_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtime manifest schema: ${String(manifest.schemaVersion)}`);
  }
  const stringFields: Array<keyof RuntimeManifest> = [
    "runtimeVersion",
    "minShellVersion",
    "requiredEngineVersion",
    "requiredNodeVersion",
    "platform",
    "arch",
    "entrypoint",
  ];
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

export async function readRuntimeManifest(runtimeRoot: string): Promise<RuntimeManifest> {
  return parseRuntimeManifest(
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

function parseNumericVersion(value: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseNumericVersion(left);
  const rightParts = parseNumericVersion(right);
  if (!leftParts || !rightParts) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
