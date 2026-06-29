import {
  isRuntimeReleaseCompatible,
  pickLatestCompatibleRuntimeRelease,
  type RuntimeReleaseMetadata,
  type RuntimeReleaseProvider,
  type RuntimeReleaseTarget,
} from "./runtime-release-provider.js";

function parseGitHubReleaseMetadataEntry(value: unknown): RuntimeReleaseMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error("GitHub runtime release metadata entry must be an object");
  }

  const entry = value as Partial<RuntimeReleaseMetadata>;
  if (typeof entry.version !== "string" || entry.version.trim().length === 0) {
    throw new Error("GitHub runtime release metadata version is required");
  }
  if (typeof entry.platform !== "string" || entry.platform.trim().length === 0) {
    throw new Error("GitHub runtime release metadata platform is required");
  }
  if (typeof entry.arch !== "string" || entry.arch.trim().length === 0) {
    throw new Error("GitHub runtime release metadata arch is required");
  }
  if (typeof entry.artifactUrl !== "string" || entry.artifactUrl.trim().length === 0) {
    throw new Error("GitHub runtime release metadata artifactUrl is required");
  }
  if (typeof entry.checksumSha256 !== "string" || entry.checksumSha256.trim().length === 0) {
    throw new Error("GitHub runtime release metadata checksumSha256 is required");
  }
  if (typeof entry.artifactSize !== "number" || !Number.isFinite(entry.artifactSize)) {
    throw new Error("GitHub runtime release metadata artifactSize is required");
  }
  if (typeof entry.publishedAt !== "string" || entry.publishedAt.trim().length === 0) {
    throw new Error("GitHub runtime release metadata publishedAt is required");
  }

  return {
    version: entry.version.trim(),
    platform: entry.platform as NodeJS.Platform,
    arch: entry.arch as NodeJS.Architecture,
    artifactUrl: entry.artifactUrl.trim(),
    checksumSha256: entry.checksumSha256.trim(),
    artifactSize: entry.artifactSize,
    publishedAt: entry.publishedAt.trim(),
    ...(typeof entry.minAppVersion === "string" && entry.minAppVersion.trim().length > 0
      ? { minAppVersion: entry.minAppVersion.trim() }
      : {}),
    ...(typeof entry.notes === "string" && entry.notes.trim().length > 0
      ? { notes: entry.notes.trim() }
      : {}),
  };
}

export function extractRuntimeReleaseMetadataFromGitHubIndex(
  value: unknown
): RuntimeReleaseMetadata[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub runtime release index must be an array");
  }

  return value.map((entry) => parseGitHubReleaseMetadataEntry(entry));
}

export class GitHubRuntimeReleaseProvider implements RuntimeReleaseProvider {
  private readonly fetchReleaseIndex: () => Promise<unknown>;

  constructor(input: { fetchReleaseIndex: () => Promise<unknown> }) {
    this.fetchReleaseIndex = input.fetchReleaseIndex;
  }

  async resolveLatestCompatible(
    target: RuntimeReleaseTarget
  ): Promise<RuntimeReleaseMetadata | null> {
    const releases = extractRuntimeReleaseMetadataFromGitHubIndex(await this.fetchReleaseIndex());
    return pickLatestCompatibleRuntimeRelease(releases, target);
  }

  async resolveVersion(
    version: string,
    target: RuntimeReleaseTarget
  ): Promise<RuntimeReleaseMetadata | null> {
    const releases = extractRuntimeReleaseMetadataFromGitHubIndex(await this.fetchReleaseIndex());
    const matched = releases.filter((release) => release.version === version);
    return matched.find((release) => isRuntimeReleaseCompatible(release, target)) ?? null;
  }
}
