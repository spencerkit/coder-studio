import type { ProductChannel, ProductChannelRuntime, ProductRelease } from "./product-channel.js";
import {
  assertSafeReleaseAssetName,
  assertSafeReleaseTag,
  parseChannelTimestamp,
  parseReleaseCapabilities,
  type ReleaseCapabilities,
  readChannelSha256,
  readChannelString,
  resolveVersionedReleaseAsset,
} from "./release-channel.js";
import { compareVersions, isSemanticVersion, type RuntimeSignature } from "./runtime-manifest.js";
import { canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

export interface ProductCompatibilityHost extends ReleaseCapabilities {
  shellVersion: string;
}

export interface ProductIndex {
  schemaVersion: 1;
  channel: "product-index";
  generatedAt: string;
  latestVersion: string;
  releases: ProductIndexRelease[];
  signature: RuntimeSignature;
}

export type ProductReleaseSource = ProductChannel | ProductIndex;

export interface ProductIndexRelease {
  version: string;
  releaseTag: string;
  publishedAt: string;
  minShellVersion: string;
  requirements: ReleaseCapabilities;
  runtimes: Record<
    "win32-x64" | "linux-x64",
    Pick<ProductChannelRuntime, "manifest" | "manifestSha256">
  >;
}

function parseRuntime(
  value: unknown,
  label: string,
  indexUrl: string,
  releaseTag: string
): Pick<ProductChannelRuntime, "manifest" | "manifestSha256"> {
  if (!value || typeof value !== "object") {
    throw new Error(`Product index ${label} Runtime must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const manifest = readChannelString(candidate.manifest, `Product index ${label}.manifest`);
  assertSafeReleaseAssetName(manifest);
  resolveVersionedReleaseAsset(indexUrl, releaseTag, manifest);
  return {
    manifest,
    manifestSha256: readChannelSha256(
      candidate.manifestSha256,
      `Product index ${label}.manifestSha256`
    ),
  };
}

function parseRelease(value: unknown, indexUrl: string, position: number): ProductIndexRelease {
  if (!value || typeof value !== "object") {
    throw new Error(`Product index release ${position} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const label = `release ${position}`;
  const version = readChannelString(candidate.version, `Product index ${label}.version`);
  if (!isSemanticVersion(version)) {
    throw new Error(`Product index ${label}.version must be a semantic version`);
  }
  const releaseTag = readChannelString(candidate.releaseTag, `Product index ${label}.releaseTag`);
  assertSafeReleaseTag(releaseTag);
  const publishedAt = parseChannelTimestamp(
    candidate.publishedAt,
    `Product index ${label}.publishedAt`
  );
  if (!candidate.runtimes || typeof candidate.runtimes !== "object") {
    throw new Error(`Product index ${label}.runtimes must be an object`);
  }
  const runtimes = candidate.runtimes as Record<string, unknown>;
  const minShellVersion = readChannelString(
    candidate.minShellVersion,
    `Product index ${label}.minShellVersion`
  );
  if (!isSemanticVersion(minShellVersion)) {
    throw new Error(`Product index ${label}.minShellVersion must be a semantic version`);
  }
  return {
    version,
    releaseTag,
    publishedAt,
    minShellVersion,
    requirements: parseReleaseCapabilities(
      candidate.requirements,
      `Product index ${label}.requirements`
    ),
    runtimes: {
      "win32-x64": parseRuntime(
        runtimes["win32-x64"],
        `${label}.runtimes.win32-x64`,
        indexUrl,
        releaseTag
      ),
      "linux-x64": parseRuntime(
        runtimes["linux-x64"],
        `${label}.runtimes.linux-x64`,
        indexUrl,
        releaseTag
      ),
    },
  };
}

export function parseProductIndex(
  value: unknown,
  publicKeyPem: string,
  indexUrl: string,
  options: { allowUnsigned?: boolean } = {}
): ProductIndex {
  if (!value || typeof value !== "object") throw new Error("Product index must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Product index schema");
  if (candidate.channel !== "product-index") throw new Error("Product index kind is unsupported");
  if (!Array.isArray(candidate.releases) || candidate.releases.length === 0) {
    throw new Error("Product index releases must be a non-empty array");
  }
  const releases = candidate.releases.map((release, index) =>
    parseRelease(release, indexUrl, index)
  );
  const versions = new Set<string>();
  const tags = new Set<string>();
  for (const release of releases) {
    if (versions.has(release.version)) throw new Error("Product index versions must be unique");
    if (tags.has(release.releaseTag)) throw new Error("Product index release tags must be unique");
    versions.add(release.version);
    tags.add(release.releaseTag);
  }
  const latestVersion = readChannelString(candidate.latestVersion, "Product index latestVersion");
  const highestVersion = [...releases].sort((left, right) =>
    compareVersions(right.version, left.version)
  )[0]?.version;
  if (latestVersion !== highestVersion) {
    throw new Error("Product index latestVersion must identify the highest release");
  }
  const productIndex: ProductIndex = {
    schemaVersion: 1,
    channel: "product-index",
    generatedAt: parseChannelTimestamp(candidate.generatedAt, "Product index generatedAt"),
    latestVersion,
    releases,
    signature: candidate.signature as RuntimeSignature,
  };
  if (
    !options.allowUnsigned &&
    !verifyEd25519Payload(
      canonicalSigningPayload(productIndex),
      productIndex.signature,
      publicKeyPem
    )
  ) {
    throw new Error("Product index signature is invalid");
  }
  return productIndex;
}

export function resolveProductIndexUrl(productChannelUrl: string): string {
  const url = new URL(productChannelUrl);
  const separator = url.pathname.lastIndexOf("/");
  url.pathname = `${url.pathname.slice(0, separator + 1)}product-index.json`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isProductReleaseCompatible(
  release: Pick<ProductRelease, "minShellVersion" | "requirements">,
  host: ProductCompatibilityHost
): boolean {
  return (
    isSemanticVersion(host.shellVersion) &&
    isSemanticVersion(release.minShellVersion) &&
    compareVersions(host.shellVersion, release.minShellVersion) >= 0 &&
    release.requirements.engineVersion === host.engineVersion &&
    release.requirements.nodeVersion === host.nodeVersion &&
    release.requirements.runtimeHostApiVersion === host.runtimeHostApiVersion &&
    release.requirements.apiProtocolVersion === host.apiProtocolVersion &&
    release.requirements.dataSchemaVersion === host.dataSchemaVersion
  );
}

export function selectHighestCompatibleProductRelease(
  source: ProductReleaseSource,
  host: ProductCompatibilityHost
): ProductRelease | null {
  return listCompatibleProductReleases(source, host)[0] ?? null;
}

export function listProductReleases(source: ProductReleaseSource): ProductRelease[] {
  if (source.channel !== "product-index") return [source];
  return source.releases
    .map((selected) => ({
      version: selected.version,
      releaseTag: selected.releaseTag,
      minShellVersion: selected.minShellVersion,
      requirements: selected.requirements,
      runtimes: {
        "win32-x64": {
          ...selected.runtimes["win32-x64"],
          version: selected.version,
          publishedAt: selected.publishedAt,
        },
        "linux-x64": {
          ...selected.runtimes["linux-x64"],
          version: selected.version,
          publishedAt: selected.publishedAt,
        },
      },
    }))
    .sort((left, right) => compareVersions(right.version, left.version));
}

export function listCompatibleProductReleases(
  source: ProductReleaseSource,
  host: ProductCompatibilityHost
): ProductRelease[] {
  return listProductReleases(source).filter((release) => isProductReleaseCompatible(release, host));
}
