import { join } from "node:path";

export function getRuntimeStateRoot(stateRoot: string, runtimeId: string): string {
  return join(stateRoot, "state", "runtimes", runtimeId);
}

export function getRuntimeStateFile(
  stateRoot: string,
  runtimeId: string,
  ...parts: string[]
): string {
  return join(getRuntimeStateRoot(stateRoot, runtimeId), ...parts);
}

function normalizeWslDistro(distro: string): string {
  const normalized = distro.trim();
  if (normalized.length === 0) {
    throw new Error("WSL distro is required");
  }

  return normalized;
}

export function getWslDistroBridgeRuntimeId(distro: string): string {
  return `wsl:distro:${normalizeWslDistro(distro)}`;
}
