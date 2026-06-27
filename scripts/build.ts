/**
 * Full production build script
 * Runs build:web, build:cli, then build:desktop
 */

import { buildCli } from "./build-cli.js";
import { buildDesktop } from "./build-desktop.js";
import { buildWeb } from "./build-web.js";
import { error, log, step } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

async function build(): Promise<void> {
  step("BUILD", "Running full production build...\n");

  // Step 1: Build web
  await buildWeb();

  // Step 2: Build CLI (includes assembling web assets)
  await buildCli();

  // Step 3: Build desktop shell and staged runtime bundle
  await buildDesktop();

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
