import { join } from "node:path";

export interface WslDistroRuntimeStoreLayout {
  coderStudioHomeDir: string;
  runtimeStoreDir: string;
  runtimeVersionsDir: string;
  runtimeCurrentPointerPath: string;
  bridgeRunDir: string;
}

export function resolveWslDistroRuntimeStoreLayout(homeDir: string): WslDistroRuntimeStoreLayout {
  const coderStudioHomeDir = join(homeDir, ".coder-studio");
  const runtimeStoreDir = join(coderStudioHomeDir, "runtime-store");

  return {
    coderStudioHomeDir,
    runtimeStoreDir,
    runtimeVersionsDir: join(runtimeStoreDir, "versions"),
    runtimeCurrentPointerPath: join(runtimeStoreDir, "current.json"),
    bridgeRunDir: join(coderStudioHomeDir, "run"),
  };
}
