export interface RuntimeReleaseMetadata {
  version: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  artifactUrl: string;
  checksumSha256: string;
  artifactSize: number;
  publishedAt: string;
  minAppVersion?: string;
  notes?: string;
}

export interface RuntimeReleaseTarget {
  appVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}

export interface RuntimeReleaseProvider {
  resolveLatestCompatible(target: RuntimeReleaseTarget): Promise<RuntimeReleaseMetadata | null>;
  resolveVersion(
    version: string,
    target: RuntimeReleaseTarget
  ): Promise<RuntimeReleaseMetadata | null>;
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .split(".")
    .map((segment) => {
      const match = segment.match(/^(\d+)/);
      return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
    });
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

export function isRuntimeReleaseCompatible(
  release: RuntimeReleaseMetadata,
  target: RuntimeReleaseTarget
): boolean {
  if (release.platform !== target.platform || release.arch !== target.arch) {
    return false;
  }
  if (release.minAppVersion && compareVersions(target.appVersion, release.minAppVersion) < 0) {
    return false;
  }
  return true;
}

export function pickLatestCompatibleRuntimeRelease(
  releases: readonly RuntimeReleaseMetadata[],
  target: RuntimeReleaseTarget
): RuntimeReleaseMetadata | null {
  const compatible = releases.filter((release) => isRuntimeReleaseCompatible(release, target));
  if (compatible.length === 0) {
    return null;
  }

  return compatible.sort((left, right) => compareVersions(right.version, left.version))[0] ?? null;
}
