/**
 * Build script for CLI package
 * Creates ESM + CJS bundles with esbuild and assembles web assets
 */

import * as esbuild from 'esbuild';
import {
  CLI_DIR,
  CLI_ESM_DIR,
  CLI_CJS_DIR,
  CLI_WEB_DIR,
  WEB_DIST_DIR,
  HOOK_BRIDGE_SRC,
  RUNTIME_HOOKS_DIR,
  log,
  info,
  success,
  error,
  step,
  ensureDir,
  copyDir,
  exists,
  createCliBuildOptions,
} from './shared/index.js';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';

async function buildCli(): Promise<void> {
  step('BUILD CLI', 'Building CLI bundle with esbuild...\n');

  // Ensure output directories exist
  await ensureDir(CLI_ESM_DIR);
  await ensureDir(CLI_CJS_DIR);
  await ensureDir(CLI_WEB_DIR);

  // Build ESM bundle
  info('Building ESM bundle...');
  const esmOptions = await createCliBuildOptions('esm');
  await esbuild.build(esmOptions);
  success(`ESM bundle: ${esmOptions.outfile}`);

  // Build CJS bundle
  info('Building CJS bundle...');
  const cjsOptions = await createCliBuildOptions('cjs');
  await esbuild.build(cjsOptions);
  success(`CJS bundle: ${cjsOptions.outfile}`);

  // Create bin.js wrapper (for ESM)
  info('Creating bin.js entry point...');
  const binPath = resolve(CLI_DIR, 'dist/bin.js');
  const binContent = `#!/usr/bin/env node
// @coder-studio/cli - Entry point wrapper
import('./esm/index.mjs').catch((err) => {
  console.error('Failed to start CLI:', err);
  process.exit(1);
});
`;
  await writeFile(binPath, binContent, { mode: 0o755 });
  success(`bin.js: ${binPath}`);

  // Copy web assets
  info('Copying web assets...');
  if (await exists(WEB_DIST_DIR)) {
    await copyDir(WEB_DIST_DIR, CLI_WEB_DIR);
    success(`Web assets: ${CLI_WEB_DIR}`);
  } else {
    throw new Error(
      'Web dist not found. Run build:web first (pnpm build:web)'
    );
  }

  // Copy hook-bridge scripts
  info('Copying hook-bridge scripts...');
  if (await exists(HOOK_BRIDGE_SRC)) {
    await ensureDir(RUNTIME_HOOKS_DIR);
    await copyDir(HOOK_BRIDGE_SRC, RUNTIME_HOOKS_DIR);
    success(`Hook scripts: ${RUNTIME_HOOKS_DIR}`);
  } else {
    error('Warning: hook-bridge source not found, skipping');
  }

  log('\n✓ CLI build complete.');
  log(`  Entry:    ${binPath}`);
  log(`  ESM:      ${esmOptions.outfile}`);
  log(`  CJS:      ${cjsOptions.outfile}`);
  log(`  Web:      ${CLI_WEB_DIR}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildCli()
    .then(() => {
      log('\n✓ CLI build complete.\n');
      process.exit(0);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}

export { buildCli };