import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  const runtimeRoot = input.isPackaged
    ? join(input.resourcesPath, "runtime")
    : join(input.appPath, "dist", "runtime");
  const activeRuntimePointer = readActiveRuntimePointerSync(
    join(input.userDataDir, "runtime-store", "current.json")
  );

  return {
    nodeExecutable: join(runtimeRoot, "node", platform === "win32" ? "node.exe" : "node"),
    runtimeEntry: activeRuntimePointer
      ? resolve(activeRuntimePointer.path, activeRuntimePointer.entry)
      : join(runtimeRoot, "embedded", "dist", "esm", "runtime-launch-entry.mjs"),
    ...(activeRuntimePointer ? { runtimeVersion: activeRuntimePointer.version } : {}),
    webRoot: activeRuntimePointer
      ? resolve(activeRuntimePointer.path, activeRuntimePointer.webRoot)
      : join(runtimeRoot, "embedded", "dist", "web"),
    runtimeJsonPath: join(input.userDataDir, "runtime", "runtime.json"),
  };
}
