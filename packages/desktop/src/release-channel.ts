import { normalizeUtcTimestamp } from "./build-info.js";

export interface ReleaseCapabilities {
  engineVersion: string;
  nodeVersion: string;
  runtimeHostApiVersion: number;
  apiProtocolVersion: number;
  dataSchemaVersion: number;
}

export function readChannelString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function readChannelPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

export function readChannelSha256(value: unknown, label: string): string {
  const digest = readChannelString(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest;
}

export function parseReleaseCapabilities(value: unknown, label: string): ReleaseCapabilities {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const candidate = value as Record<string, unknown>;
  return {
    engineVersion: readChannelString(candidate.engineVersion, `${label}.engineVersion`),
    nodeVersion: readChannelString(candidate.nodeVersion, `${label}.nodeVersion`),
    runtimeHostApiVersion: readChannelPositiveInteger(
      candidate.runtimeHostApiVersion,
      `${label}.runtimeHostApiVersion`
    ),
    apiProtocolVersion: readChannelPositiveInteger(
      candidate.apiProtocolVersion,
      `${label}.apiProtocolVersion`
    ),
    dataSchemaVersion: readChannelPositiveInteger(
      candidate.dataSchemaVersion,
      `${label}.dataSchemaVersion`
    ),
  };
}

export function assertSafeReleaseTag(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error("Release channel release tag is unsafe");
  }
}

export function assertSafeReleaseAssetName(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)) {
    throw new Error("Release channel asset name is unsafe");
  }
}

export function resolveVersionedReleaseAsset(
  channelUrl: string,
  releaseTag: string,
  assetName: string
): string {
  assertSafeReleaseTag(releaseTag);
  assertSafeReleaseAssetName(assetName);
  const pointer = new URL(channelUrl);
  const marker = "/releases/download/";
  const markerIndex = pointer.pathname.indexOf(marker);
  if (markerIndex < 0) throw new Error("Release channel URL is not tag-pinned");
  pointer.pathname = `${pointer.pathname.slice(0, markerIndex + marker.length)}${releaseTag}/${assetName}`;
  pointer.search = "";
  pointer.hash = "";
  return pointer.toString();
}

export function parseChannelTimestamp(value: unknown, label: string): string {
  return normalizeUtcTimestamp(value, label);
}
