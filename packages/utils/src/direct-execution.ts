import { posix, resolve } from "node:path";

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function normalizeComparablePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");

  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("//")) {
    normalized = `//${posix.normalize(normalized.slice(2))}`;
  } else {
    normalized = posix.normalize(normalized);
  }

  if (isWindowsDrivePath(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function normalizeModuleUrlPath(moduleUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(moduleUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "file:") {
    return null;
  }

  const path = `${url.host ? `//${url.host}` : ""}${decodeURIComponent(url.pathname)}`;
  return normalizeComparablePath(path);
}

function normalizeArgvPath(argv1: string): string {
  const isAbsoluteWindowsPath = /^[A-Za-z]:[\\/]/.test(argv1) || /^\\\\/.test(argv1);
  return normalizeComparablePath(isAbsoluteWindowsPath ? argv1 : resolve(argv1));
}

export function isDirectExecution(
  moduleUrl: string,
  argv1: string | undefined = process.argv[1]
): boolean {
  if (argv1 === undefined) {
    return false;
  }

  const modulePath = normalizeModuleUrlPath(moduleUrl);

  if (modulePath === null) {
    return false;
  }

  return modulePath === normalizeArgvPath(argv1);
}
