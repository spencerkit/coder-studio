import { existsSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import type { ActiveRuntimePointer } from "./runtime-store.js";

export interface EmbeddedRuntimePathInput {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  userDataDir: string;
  platform?: NodeJS.Platform;
}

export interface EmbeddedRuntimePaths {
  nodeExecutable: string;
  runtimeEntry: string;
  runtimeVersion?: string;
  webRoot: string;
  runtimeJsonPath: string;
}

function readActiveRuntimePointerSync(currentPointerPath: string): ActiveRuntimePointer | null {
  try {
    if (!existsSync(currentPointerPath)) {
      return null;
    }

    const parsed = JSON.parse(
      readFileSync(currentPointerPath, "utf-8")
    ) as Partial<ActiveRuntimePointer>;
    if (
      typeof parsed.version !== "string" ||
      typeof parsed.installedAt !== "number" ||
      typeof parsed.path !== "string" ||
      typeof parsed.entry !== "string" ||
      typeof parsed.checksumSha256 !== "string" ||
      typeof parsed.source !== "string"
    ) {
      return null;
    }

    return {
      version: parsed.version,
      installedAt: parsed.installedAt,
      path: parsed.path,
      entry: parsed.entry,
      webRoot:
        typeof parsed.webRoot === "string" && parsed.webRoot.trim().length > 0
          ? parsed.webRoot
          : "dist/web",
      checksumSha256: parsed.checksumSha256,
      source: parsed.source,
      ...(typeof parsed.previousVersion === "string"
        ? { previousVersion: parsed.previousVersion }
        : {}),
    };
  } catch {
    return null;
  }
}

export function resolveEmbeddedRuntimePaths(input: EmbeddedRuntimePathInput): EmbeddedRuntimePaths {
  const platform = input.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const appPath = input.appPath.replaceAll("\\", path.sep);
  const runtimeRoot = input.isPackaged
    ? path.join(input.resourcesPath, "runtime")
    : appPath.endsWith(`${path.sep}dist${path.sep}electron`)
      ? path.join(path.dirname(appPath), "runtime")
      : path.join(appPath, "dist", "runtime");
  const activeRuntimePointer = readActiveRuntimePointerSync(
    path.join(input.userDataDir, "runtime-store", "current.json")
  );

  return {
    nodeExecutable: path.join(runtimeRoot, "node", platform === "win32" ? "node.exe" : "node"),
    runtimeEntry: activeRuntimePointer
      ? path.resolve(activeRuntimePointer.path, activeRuntimePointer.entry)
      : path.join(runtimeRoot, "embedded", "dist", "esm", "runtime-launch-entry.mjs"),
    ...(activeRuntimePointer ? { runtimeVersion: activeRuntimePointer.version } : {}),
    webRoot: activeRuntimePointer
      ? path.resolve(activeRuntimePointer.path, activeRuntimePointer.webRoot)
      : path.join(runtimeRoot, "embedded", "dist", "web"),
    runtimeJsonPath: path.join(input.userDataDir, "runtime", "runtime.json"),
  };
}
