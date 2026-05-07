/**
 * Full production build script
 * Runs build:web then build:cli
 */

import { buildCli } from "./build-cli.js";
import { buildWeb } from "./build-web.js";
import { error, info, log, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

async function build(): Promise<void> {
  step("BUILD", "Running full production build...\n");

  // Step 1: Build web
  await buildWeb();

  // Step 2: Build CLI (includes assembling web assets)
  await buildCli();

  log("\n✓ Full production build complete.\n");
}

// Run if called directly
if (isDirectExecution(import.meta.url)) {
  build()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}

export { build };
