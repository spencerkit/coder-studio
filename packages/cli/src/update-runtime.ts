import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UpdateRuntimeContext } from "@coder-studio/core";
import { getCliPackageName } from "./package-manifest.js";

export interface UpdateRuntimeInfo {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  runtimeContext: UpdateRuntimeContext;
  packageName: string;
  cliCommand: string;
  workerEntryPath?: string;
  npmCommand: string;
  registryUrl: string;
  distTag: string;
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

  const supported = workerEntryPath !== undefined;
  const registryUrl =
    process.env.CODER_STUDIO_UPDATE_REGISTRY_URL?.trim() ||
    process.env.npm_config_registry?.trim() ||
    "https://registry.npmjs.org/";
  const distTag = process.env.CODER_STUDIO_UPDATE_DIST_TAG?.trim() || "latest";

  return {
    supported,
    installKind: supported ? "global_npm" : "unsupported",
    runtimeContext: supported
      ? {
          environment: "cli-global-npm",
          authority: "cli",
          supported: true,
          unsupportedReason: null,
        }
      : {
          environment: "cli-unsupported",
          authority: "none",
          supported: false,
          unsupportedReason,
        },
    packageName,
    cliCommand: "coder-studio",
    workerEntryPath,
    npmCommand: "npm",
    registryUrl,
    distTag,
    restartArgs: ["serve", "--restart"],
    installArgsPrefix: ["install", "-g"],
    unsupportedReason,
  };
}
