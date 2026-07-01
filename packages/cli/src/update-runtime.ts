import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCliPackageName } from "./package-manifest.js";

export interface UpdateRuntimeInfo {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  packageName: string;
  cliCommand: string;
  workerEntryPath?: string;
  npmCommand: string;
  restartArgs: string[];
  installArgsPrefix: string[];
  unsupportedReason: string | null;
}

function resolveWorkerEntryPath(importMetaUrl: string): string | undefined {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    join(currentDir, "update-worker.mjs"),
    join(currentDir, "../src/update-worker.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function getUpdateRuntimeInfo(importMetaUrl: string): UpdateRuntimeInfo {
  const workerEntryPath = resolveWorkerEntryPath(importMetaUrl);
  const packageName = getCliPackageName(importMetaUrl);
  const unsupportedReason =
    workerEntryPath === undefined ? "In-app update worker bundle is not available" : null;

  return {
    supported: workerEntryPath !== undefined,
    installKind: workerEntryPath !== undefined ? "global_npm" : "unsupported",
    packageName,
    cliCommand: "coder-studio-cli",
    workerEntryPath,
    npmCommand: "npm",
    restartArgs: ["serve", "--restart"],
    installArgsPrefix: ["install", "-g"],
    unsupportedReason,
  };
}
