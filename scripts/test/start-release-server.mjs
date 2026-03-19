import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRuntime, stopRuntime } from '../../packages/coder-studio/lib/runtime-controller.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const binaryName = process.platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
const binaryPath = path.join(ROOT, 'src-tauri', 'target', 'release', binaryName);
const distDir = path.join(ROOT, 'dist');
const stateDir = path.join(ROOT, '.tmp', 'release-e2e-runtime');
const env = {
  ...process.env,
  CODER_STUDIO_BINARY_PATH: binaryPath,
  CODER_STUDIO_DIST_DIR: distDir,
  CODER_STUDIO_HOME: stateDir
};

await fs.mkdir(path.join(ROOT, '.tmp'), { recursive: true });
await stopRuntime({ stateDir, env }).catch(() => undefined);
await startRuntime({
  stateDir,
  host: '127.0.0.1',
  port: 4173,
  foreground: true,
  env,
  onReady: async ({ endpoint, pid }) => {
    console.log(`release runtime ready: ${endpoint} pid=${pid}`);
  }
});
