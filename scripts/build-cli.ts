/**
 * Build script for CLI package
 * Creates the publishable CLI bundle and copies web assets
 */

import * as esbuild from "esbuild";
import { rm, writeFile } from "fs/promises";
import { resolve } from "path";
import {
  CLI_DIR,
  CLI_ESM_DIR,
  CLI_WEB_DIR,
  copyDir,
  createCliBuildOptions,
  ensureDir,
  error,
  exists,
  info,
  log,
  ROOT_DIR,
  run,
  SERVER_DIR,
  step,
  success,
  WEB_DIST_DIR,
} from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export interface CliOutputDirs {
  cliDistDir: string;
  cliEsmDir: string;
  cliWebDir: string;
}

export async function prepareCliOutputDirs({
  cliDistDir,
  cliEsmDir,
  cliWebDir,
}: CliOutputDirs): Promise<void> {
  await rm(cliDistDir, { recursive: true, force: true });
  await ensureDir(cliEsmDir);
  await ensureDir(cliWebDir);
}

async function buildCli(): Promise<void> {
  step("BUILD CLI", "Building CLI bundle with esbuild...\n");

  // Start from a clean package dist so stale hashed assets are never published.
  await prepareCliOutputDirs({
    cliDistDir: resolve(CLI_DIR, "dist"),
    cliEsmDir: CLI_ESM_DIR,
    cliWebDir: CLI_WEB_DIR,
  });

  // Build ESM bundle only (server uses ESM features like top-level await)
  info("Building ESM bundle...");
  const esmOptions = await createCliBuildOptions("esm");
  await esbuild.build(esmOptions);
  success(`ESM bundle: ${resolve(CLI_DIR, "dist/esm/bin.mjs")}`);

  info("Generating public type declarations...");
  await run(
    "pnpm",
    ["--filter", "@spencer-kit/coder-studio", "exec", "tsc", "-p", "tsconfig.publish.json"],
    { cwd: ROOT_DIR }
  );
  success(`Types: ${resolve(CLI_DIR, "dist/esm/index.d.ts")}`);

  // Create bin.js wrapper (for ESM)
  info("Creating bin.js entry point...");
  const binPath = resolve(CLI_DIR, "dist/bin.js");
  const binContent = `#!/usr/bin/env node
// @spencer-kit/coder-studio - Entry point wrapper
import('./esm/bin.mjs').catch((err) => {
  console.error('Failed to start CLI:', err);
  process.exit(1);
});
`;
  await writeFile(binPath, binContent, { mode: 0o755 });
  success(`bin.js: ${binPath}`);

  // Copy web assets
  info("Copying web assets...");
  if (await exists(WEB_DIST_DIR)) {
    await copyDir(WEB_DIST_DIR, CLI_WEB_DIR);
    success(`Web assets: ${CLI_WEB_DIR}`);
  } else {
    throw new Error("Web dist not found. Run build:web first (pnpm build:web)");
  }

  log("\n✓ CLI build complete.");
  log(`  Entry:    ${binPath}`);
  log(`  ESM:      ${resolve(CLI_DIR, "dist/esm/bin.mjs")}`);
  log(`  Web:      ${CLI_WEB_DIR}`);
}

// Run if called directly
if (isDirectExecution(import.meta.url)) {
  buildCli()
    .then(() => {
      log("\n✓ CLI build complete.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}

export { buildCli };
