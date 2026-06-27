import path from "node:path";
import { toWslPath } from "../terminal-profiles/wsl.js";

const WSL_UNC_PATH_PATTERN =
  /^(?:\\\\|\/\/)(?:wsl\$|wsl\.localhost)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/i;

function normalizeAbsolutePosixPath(value: string): string {
  const normalized = path.posix.normalize(value);
  if (!normalized.startsWith("/")) {
    throw new Error("WSL workspace path must be an absolute Linux path");
  }
  return normalized;
}

function toLinuxPathFromWslUnc(value: string, selectedDistro?: string): string | null {
  const match = WSL_UNC_PATH_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const uncDistro = match[1]?.trim();
  if (selectedDistro && uncDistro && uncDistro !== selectedDistro.trim()) {
    throw new Error(`WSL path points to a different distro: ${uncDistro}`);
  }

  const relative = (match[2] ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  return relative.length > 0 ? `/${relative}` : "/";
}

export function canonicalizeWslWorkspacePath(value: string, selectedDistro?: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("WSL workspace path is required");
  }

  if (trimmed.startsWith("/")) {
    return normalizeAbsolutePosixPath(trimmed);
  }

  const uncLinuxPath = toLinuxPathFromWslUnc(trimmed, selectedDistro);
  if (uncLinuxPath) {
    return normalizeAbsolutePosixPath(uncLinuxPath);
  }

  const mappedWindowsPath = toWslPath(trimmed);
  if (mappedWindowsPath) {
    return normalizeAbsolutePosixPath(mappedWindowsPath);
  }

  throw new Error("WSL workspace path must be an absolute Linux path");
}
