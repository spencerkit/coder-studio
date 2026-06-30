import { join } from "node:path";

type Semver = readonly [major: number, minor: number, patch: number];

const VERSION_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const COMPARATOR_PATTERN = /^(<=|>=|<|>|=)?(v?\d+(?:\.\d+){0,2})$/;

export function resolveManagedWslNodePath(homeDir: string, nodeVersion: string): string {
  return join(homeDir, ".coder-studio", "node", nodeVersion, "bin", "node");
}

export function isCompatibleManagedNodeVersion(
  currentVersion: string,
  requiredRange: string
): boolean {
  const current = parseSemver(currentVersion);
  if (!current) {
    return false;
  }

  const normalizedRange = requiredRange.trim();
  if (!normalizedRange) {
    return true;
  }

  return normalizedRange
    .split(/\s*\|\|\s*/u)
    .some((group) => group.split(/\s+/u).every((token) => satisfiesComparator(current, token)));
}

function satisfiesComparator(current: Semver, token: string): boolean {
  const match = COMPARATOR_PATTERN.exec(token);
  if (!match) {
    return false;
  }

  const operator = match[1] ?? "=";
  const version = match[2];
  if (!version) {
    return false;
  }

  const expected = parseSemver(version);
  if (!expected) {
    return false;
  }

  const comparison = compareSemver(current, expected);

  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "=":
      return comparison === 0;
    default:
      return false;
  }
}

function parseSemver(value: string): Semver | undefined {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const major = match[1];
  if (!major) {
    return undefined;
  }

  return [
    Number.parseInt(major, 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}

function compareSemver(left: Semver, right: Semver): number {
  if (left[0] !== right[0]) {
    return left[0] - right[0];
  }

  if (left[1] !== right[1]) {
    return left[1] - right[1];
  }

  return left[2] - right[2];
}
