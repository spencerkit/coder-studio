import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRuntime, stopRuntime } from '../../.build/cli/lib/runtime-controller.mjs';
import { resolveServerBinaryPath } from '../lib/server-build.mjs';
import { buildDevStackRuntimeEnv } from './dev-stack-runtime.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const binaryPath = resolveServerBinaryPath();
const distDir = path.join(ROOT, '.build', 'web', 'dist');
const runtime = buildDevStackRuntimeEnv(ROOT, {
  ...process.env,
  CODER_STUDIO_HOME: process.env.CODER_STUDIO_HOME ?? path.join(ROOT, '.tmp', 'release-e2e-runtime'),
  CODER_STUDIO_DATA_DIR: process.env.CODER_STUDIO_DATA_DIR,
  CODER_STUDIO_CLAUDE_HOME: process.env.CODER_STUDIO_CLAUDE_HOME,
  CODER_STUDIO_CODEX_HOME: process.env.CODER_STUDIO_CODEX_HOME,
});
const env = {
  ...runtime.env,
  CODER_STUDIO_BINARY_PATH: binaryPath,
  CODER_STUDIO_DIST_DIR: distDir,
};

await fs.mkdir(path.join(ROOT, '.tmp'), { recursive: true });
await stopRuntime({ stateDir: runtime.stateDir, env }).catch(() => undefined);
await fs.rm(runtime.stateDir, { recursive: true, force: true });
await startRuntime({
  stateDir: runtime.stateDir,
  host: '127.0.0.1',
  port: 4173,
  foreground: true,
  env,
  onReady: async ({ endpoint, pid }) => {
    console.log(`release runtime ready: ${endpoint} pid=${pid}`);
  },
});
