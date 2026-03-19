import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 41033;
export const STATE_DIR_NAME = 'coder-studio';

export function resolveStateDir(env = process.env, platform = process.platform) {
  if (env.CODER_STUDIO_HOME) {
    return path.resolve(env.CODER_STUDIO_HOME);
  }

  const home = os.homedir();
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', STATE_DIR_NAME);
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, STATE_DIR_NAME);
  }

  const xdgStateHome = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(xdgStateHome, STATE_DIR_NAME);
}

export function resolveDataDir(stateDir, env = process.env) {
  if (env.CODER_STUDIO_DATA_DIR) {
    return path.resolve(env.CODER_STUDIO_DATA_DIR);
  }
  return path.join(stateDir, 'data');
}

export function resolveLogPath(stateDir) {
  return path.join(stateDir, 'coder-studio.log');
}

export function resolvePidPath(stateDir) {
  return path.join(stateDir, 'coder-studio.pid');
}

export function resolveRuntimePath(stateDir) {
  return path.join(stateDir, 'runtime.json');
}

export function buildEndpoint(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return `http://${host}:${port}`;
}
