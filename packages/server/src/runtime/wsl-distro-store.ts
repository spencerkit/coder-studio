import { posix } from "node:path";

export interface WslDistroRuntimeStoreLayout {
  coderStudioHomeDir: string;
  runtimeStoreDir: string;
  runtimeVersionsDir: string;
  runtimeCurrentPointerPath: string;
  bridgeRunDir: string;
}

export function resolveWslDistroRuntimeStoreLayout(homeDir: string): WslDistroRuntimeStoreLayout {
  const coderStudioHomeDir = posix.join(homeDir, ".coder-studio");
  const runtimeStoreDir = posix.join(coderStudioHomeDir, "runtime-store");

  return {
    coderStudioHomeDir,
    runtimeStoreDir,
    runtimeVersionsDir: posix.join(runtimeStoreDir, "versions"),
    runtimeCurrentPointerPath: posix.join(runtimeStoreDir, "current.json"),
    bridgeRunDir: posix.join(coderStudioHomeDir, "run"),
  };
}
