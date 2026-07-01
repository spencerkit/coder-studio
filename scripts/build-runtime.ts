/**
 * Build script for the runtime package
 * Keeps the root build pipeline aligned with the new runtime workspace package.
 */

import { ensureWslRuntimeEntryBuilt, error, log, step, success } from "./shared/index.js";
import { isDirectExecution, run } from "./shared/process.js";

export async function buildRuntime(): Promise<void> {
  step("BUILD RUNTIME", "Building runtime package workspace...\n");
  await run("pnpm", ["--filter", "@coder-studio/runtime", "build"]);
  const wslRuntimeEntryPath = await ensureWslRuntimeEntryBuilt();
  success(`WSL runtime entry: ${wslRuntimeEntryPath}`);
  log("\n✓ Runtime build complete.");
}

if (isDirectExecution(import.meta.url)) {
  buildRuntime()
    .then(() => {
      log("\n✓ Runtime build complete.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
