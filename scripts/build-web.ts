/**
 * Build script for web package
 * Runs Vite build to generate frontend static assets
 */

import { run } from './shared/process.js';
import {
  WEB_DIR,
  WEB_DIST_DIR,
  log,
  info,
  success,
  error,
  step,
  exists,
} from './shared/index.js';

async function buildWeb(): Promise<void> {
  step('BUILD WEB', 'Building frontend static assets...\n');

  info('Running Vite build...');
  await run('pnpm', ['vite', 'build'], { cwd: WEB_DIR });

  // Verify output
  if (!(await exists(WEB_DIST_DIR))) {
    throw new Error('Web build failed: dist directory not created');
  }

  success(`Frontend built successfully to ${WEB_DIST_DIR}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildWeb()
    .then(() => {
      log('\n✓ Web build complete.\n');
      process.exit(0);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}

export { buildWeb };