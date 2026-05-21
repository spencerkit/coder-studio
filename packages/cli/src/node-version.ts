export const MINIMUM_NODE_VERSION = "24.0.0";

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [
    Number.parseInt(major, 10) || 0,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ];
}

export function isNodeVersionSupported(version: string): boolean {
  const current = parseVersion(version);
  const minimum = parseVersion(MINIMUM_NODE_VERSION);

  for (let index = 0; index < minimum.length; index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }

  return true;
}

export function assertSupportedNodeVersion(version = process.versions.node): void {
  if (isNodeVersionSupported(version)) {
    return;
  }

  throw new Error(
    `Coder Studio requires Node.js >=${MINIMUM_NODE_VERSION}. Current version: ${version}.`
  );
}
