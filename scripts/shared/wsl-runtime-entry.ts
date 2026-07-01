import * as esbuild from "esbuild";
import { resolve } from "path";
import { ensureDir, exists } from "./copy.js";
import { createWslRuntimeEntryBuildOptions } from "./esbuild.js";
import { RUNTIME_ESM_DIR } from "./paths.js";

export const WSL_RUNTIME_ENTRY_PATH = resolve(RUNTIME_ESM_DIR, "wsl-runtime-entry.mjs");

export async function ensureWslRuntimeEntryBuilt(): Promise<string> {
  await ensureDir(RUNTIME_ESM_DIR);
  await esbuild.build(await createWslRuntimeEntryBuildOptions());

  if (!(await exists(WSL_RUNTIME_ENTRY_PATH))) {
    throw new Error(`Failed to build WSL runtime entry at ${WSL_RUNTIME_ENTRY_PATH}`);
  }

  return WSL_RUNTIME_ENTRY_PATH;
}
