import { join } from "node:path";

export interface EmbeddedRuntimePathInput {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  userDataDir: string;
  platform?: NodeJS.Platform;
}

export interface EmbeddedRuntimePaths {
  nodeExecutable: string;
  desktopServerEntry: string;
  runtimeJsonPath: string;
}

export function resolveEmbeddedRuntimePaths(input: EmbeddedRuntimePathInput): EmbeddedRuntimePaths {
  const platform = input.platform ?? process.platform;
  const runtimeRoot = input.isPackaged
    ? join(input.resourcesPath, "runtime")
    : join(input.appPath, "dist", "runtime");

  return {
    nodeExecutable: join(runtimeRoot, "node", platform === "win32" ? "node.exe" : "node"),
    desktopServerEntry: join(runtimeRoot, "cli", "dist", "esm", "desktop-server.mjs"),
    runtimeJsonPath: join(input.userDataDir, "runtime", "runtime.json"),
  };
}
