import { resolve } from "node:path";

export interface WslRuntimeSource {
  runtimeVersion: string;
  packageRoot: string;
  entryPath: string;
}

export function buildWslRuntimeSource(input: {
  runtimeVersion: string;
  packageRoot: string;
  entryRelativePath?: string;
}): WslRuntimeSource {
  const runtimeVersion = input.runtimeVersion.trim();
  if (!runtimeVersion) {
    throw new Error("WSL runtime version is required");
  }

  const packageRoot = input.packageRoot.trim();
  if (!packageRoot) {
    throw new Error("WSL runtime package root is required");
  }

  const entryRelativePath = input.entryRelativePath ?? "dist/wsl-runtime-entry.mjs";

  return {
    runtimeVersion,
    packageRoot,
    entryPath: resolve(packageRoot, entryRelativePath),
  };
}
