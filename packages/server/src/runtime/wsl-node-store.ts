import { posix } from "node:path";
import { satisfies, valid } from "semver";

export function resolveManagedWslNodeRoot(homeDir: string): string {
  return posix.join(homeDir, ".coder-studio", "node");
}

export function resolveManagedWslNodePath(homeDir: string, nodeVersion: string): string {
  return posix.join(resolveManagedWslNodeRoot(homeDir), nodeVersion, "bin", "node");
}

export function isCompatibleManagedNodeVersion(
  currentVersion: string,
  requiredRange: string
): boolean {
  const normalizedRange = requiredRange.trim();
  if (!normalizedRange) {
    return true;
  }

  const normalizedVersion = valid(currentVersion.trim());
  if (!normalizedVersion) {
    return false;
  }

  try {
    return satisfies(normalizedVersion, normalizedRange);
  } catch {
    return false;
  }
}
