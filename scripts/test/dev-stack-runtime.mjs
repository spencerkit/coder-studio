import fs from 'node:fs/promises';
import path from 'node:path';

export function buildDevStackRuntimeEnv(root, env = process.env) {
  const stateDir = env.CODER_STUDIO_HOME
    ? path.resolve(env.CODER_STUDIO_HOME)
    : path.join(root, '.tmp', 'dev-stack-runtime');

  return {
    stateDir,
    env: {
      ...env,
      CODER_STUDIO_HOME: stateDir,
    },
  };
}

export async function resetDevStackRuntimeState(stateDir) {
  await fs.rm(stateDir, { recursive: true, force: true });
  await fs.mkdir(stateDir, { recursive: true });
}
