import path from "node:path";
import { canonicalizeWslWorkspacePath } from "../workspace/wsl-paths.js";

export function decodeWindowsConsoleOutput(buffer: Buffer): string {
  if (buffer.length === 0) {
    return "";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le", 2);
  }

  const nullBytes = buffer.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nullBytes > 0) {
    return buffer.toString("utf16le");
  }

  return buffer.toString("utf8");
}

export function toWslPath(windowsPath: string): string | null {
  const parsed = path.win32.parse(windowsPath);
  if (!parsed.root || !/^[A-Za-z]:\\$/.test(parsed.root)) {
    return null;
  }

  const drive = parsed.root[0]!.toLowerCase();
  const relative = windowsPath.slice(parsed.root.length).replace(/\\/g, "/");
  return `/mnt/${drive}${relative ? `/${relative}` : ""}`;
}

function isUnsafeWslHostCwd(cwd: string): boolean {
  const normalized = cwd.trim().toLowerCase();
  return normalized.startsWith("\\\\") || normalized.startsWith("//");
}

function resolveSafeWslHostFallbackCwd(env: NodeJS.ProcessEnv): string {
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return path.win32.join(localAppData, "Temp");
  }

  const temp = env.TEMP?.trim();
  if (temp) {
    return temp;
  }

  const tmp = env.TMP?.trim();
  if (tmp) {
    return tmp;
  }

  return process.cwd();
}

export function resolveSafeWslHostCwd(env: NodeJS.ProcessEnv = process.env): string {
  const cwd = process.cwd();
  return isUnsafeWslHostCwd(cwd) ? resolveSafeWslHostFallbackCwd(env) : cwd;
}

export function toExplicitWslCwd(workspacePath: string, distro?: string): string | null {
  const trimmed = workspacePath.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return canonicalizeWslWorkspacePath(trimmed, distro);
  }

  try {
    return canonicalizeWslWorkspacePath(trimmed, distro);
  } catch {
    return toWslPath(trimmed);
  }
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
