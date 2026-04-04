import fs from 'node:fs/promises';
import path from 'node:path';

const SERVICE_STATE_FILENAME = 'service.json';

function resolveServiceStatePath(stateDir) {
  return path.join(stateDir, SERVICE_STATE_FILENAME);
}

export async function readServiceState(stateDir) {
  try {
    const raw = await fs.readFile(resolveServiceStatePath(stateDir), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeServiceState(stateDir, state) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(resolveServiceStatePath(stateDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function clearServiceState(stateDir) {
  await fs.rm(resolveServiceStatePath(stateDir), { force: true });
}
