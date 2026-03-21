import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRuntime, stopRuntime } from '../../.build/cli/lib/runtime-controller.mjs';
import { resolveServerBinaryPath } from '../lib/server-build.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const binaryPath = resolveServerBinaryPath();
const distDir = path.join(ROOT, '.build', 'web', 'dist');
const stateDir = path.join(ROOT, '.tmp', 'release-e2e-runtime');
const env = {
  ...process.env,
  CODER_STUDIO_BINARY_PATH: binaryPath,
  CODER_STUDIO_DIST_DIR: distDir,
  CODER_STUDIO_HOME: stateDir,
};

await fs.mkdir(path.join(ROOT, '.tmp'), { recursive: true });
await stopRuntime({ stateDir, env }).catch(() => undefined);
await fs.rm(stateDir, { recursive: true, force: true });
await startRuntime({
  stateDir,
  host: '127.0.0.1',
  port: 4173,
  foreground: true,
  env,
  onReady: async ({ endpoint, pid }) => {
    console.log(`release runtime ready: ${endpoint} pid=${pid}`);
  },
});
