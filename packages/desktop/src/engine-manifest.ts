import { verify } from "node:crypto";
import type { RuntimeFileEntry, RuntimeSignature } from "./runtime-manifest.js";

export const ENGINE_MANIFEST_SCHEMA_VERSION = 1;

export interface EngineManifest {
  schemaVersion: 1;
  engineVersion: string;
  nodeVersion: string;
  platform: "linux";
  arch: "x64" | "arm64";
  libc: "glibc";
  packageFile: string;
  packageSha256: string;
  packageSize: number;
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

function isSafePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function getEngineManifestSigningPayload(manifest: EngineManifest): Buffer {
  const { signature: _signature, ...unsigned } = manifest;
  return Buffer.from(canonicalize(unsigned as unknown as JsonValue), "utf8");
}

export function verifyEngineManifestSignature(
  manifest: EngineManifest,
  publicKeyPem: string
): boolean {
  if (manifest.signature?.algorithm !== "ed25519" || !manifest.signature.value) return false;
  try {
    return verify(
      null,
      getEngineManifestSigningPayload(manifest),
      publicKeyPem,
      Buffer.from(manifest.signature.value, "base64")
    );
  } catch {
    return false;
  }
}

export function parseEngineManifest(value: unknown): EngineManifest {
  if (!value || typeof value !== "object") throw new Error("Engine manifest must be an object");
  const manifest = value as Partial<EngineManifest>;
  if (manifest.schemaVersion !== ENGINE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported Engine manifest schema: ${String(manifest.schemaVersion)}`);
  }
  for (const field of [
    "engineVersion",
    "nodeVersion",
    "platform",
    "arch",
    "libc",
    "packageFile",
    "packageSha256",
  ] as const) {
    if (typeof manifest[field] !== "string" || !manifest[field]?.trim()) {
      throw new Error(`Engine manifest field ${field} must be a non-empty string`);
    }
  }
  if (manifest.platform !== "linux") throw new Error("Engine manifest platform must be linux");
  if (manifest.arch !== "x64" && manifest.arch !== "arm64") {
    throw new Error(`Unsupported Engine architecture: ${String(manifest.arch)}`);
  }
  if (manifest.libc !== "glibc") throw new Error("Engine manifest libc must be glibc");
  if (!isSafePath(manifest.packageFile as string) || manifest.packageFile?.includes("/")) {
    throw new Error("Engine manifest packageFile is unsafe");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.packageSha256 as string)) {
    throw new Error("Engine manifest packageSha256 is invalid");
  }
  if (!Number.isSafeInteger(manifest.packageSize) || (manifest.packageSize as number) <= 0) {
    throw new Error("Engine manifest packageSize is invalid");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Engine manifest must contain files");
  }
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file ||
      !isSafePath(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      paths.has(file.path)
    ) {
      throw new Error("Engine manifest contains an invalid file entry");
    }
    paths.add(file.path);
  }
  return manifest as EngineManifest;
}
