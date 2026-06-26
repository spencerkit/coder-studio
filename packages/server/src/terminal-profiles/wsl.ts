import path from "node:path";

export function toWslPath(windowsPath: string): string | null {
  const parsed = path.win32.parse(windowsPath);
  if (!parsed.root || !/^[A-Za-z]:\\$/.test(parsed.root)) {
    return null;
  }

  const drive = parsed.root[0]!.toLowerCase();
  const relative = windowsPath.slice(parsed.root.length).replace(/\\/g, "/");
  return `/mnt/${drive}${relative ? `/${relative}` : ""}`;
}

export function appendWslCwd(argv: string[], mappedCwd: string | null): string[] {
  if (!mappedCwd) {
    return [...argv];
  }

  return [...argv, "--cd", mappedCwd];
}

export function formatWslLabel(distro: string): string {
  return distro.endsWith(" (WSL)") ? distro : `${distro} (WSL)`;
}
