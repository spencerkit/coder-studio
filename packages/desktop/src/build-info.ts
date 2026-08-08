import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface DesktopBuildInfo {
  schemaVersion: 1;
  shellVersion: string;
  builtAt: string | null;
  publishedAt: string | null;
  engineVersion: string | null;
  nodeVersion: string | null;
  runtimeHostApiVersion: number | null;
  apiProtocolVersion: number | null;
  dataSchemaVersion: number | null;
  metadataAvailable: boolean;
}

export function normalizeUtcTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

export function parseDesktopBuildInfo(value: unknown): DesktopBuildInfo {
  if (!value || typeof value !== "object") throw new Error("Desktop build info must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Desktop build info schema");
  return {
    schemaVersion: 1,
    shellVersion: readNonEmptyString(candidate.shellVersion, "shellVersion"),
    builtAt: normalizeUtcTimestamp(candidate.builtAt, "builtAt"),
    publishedAt: normalizeUtcTimestamp(candidate.publishedAt, "publishedAt"),
    engineVersion: readNonEmptyString(candidate.engineVersion, "engineVersion"),
    nodeVersion: readNonEmptyString(candidate.nodeVersion, "nodeVersion"),
    runtimeHostApiVersion: readPositiveInteger(
      candidate.runtimeHostApiVersion,
      "runtimeHostApiVersion"
    ),
    apiProtocolVersion: readPositiveInteger(candidate.apiProtocolVersion, "apiProtocolVersion"),
    dataSchemaVersion: readPositiveInteger(candidate.dataSchemaVersion, "dataSchemaVersion"),
    metadataAvailable: true,
  };
}

export async function readDesktopBuildInfo(
  resourcesPath: string,
  actualShellVersion: string
): Promise<DesktopBuildInfo> {
  try {
    return parseDesktopBuildInfo(
      JSON.parse(await readFile(resolve(resourcesPath, "build-info.json"), "utf8"))
    );
  } catch {
    return {
      schemaVersion: 1,
      shellVersion: actualShellVersion,
      builtAt: null,
      publishedAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      metadataAvailable: false,
    };
  }
}
