/**
 * Assembly script for hook-bridge
 * Copies hook-bridge scripts to runtime directory
 */

import {
  copyDir,
  ensureDir,
  error,
  exists,
  HOOK_BRIDGE_SRC,
  info,
  log,
  RUNTIME_DIR,
  RUNTIME_HOOKS_DIR,
  step,
  success,
} from "./shared/index.js";

async function assemble(): Promise<void> {
  step("ASSEMBLE", "Assembling runtime artifacts...\n");

  // Ensure runtime directory exists
  await ensureDir(RUNTIME_DIR);
  info(`Runtime directory: ${RUNTIME_DIR}`);

  // Copy hook-bridge scripts
  info("Copying hook-bridge scripts...");
  if (await exists(HOOK_BRIDGE_SRC)) {
    await ensureDir(RUNTIME_HOOKS_DIR);
    await copyDir(HOOK_BRIDGE_SRC, RUNTIME_HOOKS_DIR);
    success(`Hook scripts deployed to: ${RUNTIME_HOOKS_DIR}`);
  } else {
    error("Warning: hook-bridge source not found");
  }

  log("\n✓ Assembly complete.\n");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  assemble()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}

export { assemble };
