// @ts-nocheck
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLogPath, resolvePidPath, resolveRuntimePath } from './config.mjs';

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

export async function readPackageVersion() {
  const raw = await fs.readFile(PACKAGE_JSON_PATH, 'utf8');
  return JSON.parse(raw).version;
}

export async function ensureStateDirs(stateDir, dataDir) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readRuntimeState(stateDir) {
  try {
    const raw = await fs.readFile(resolveRuntimePath(stateDir), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeRuntimeState(stateDir, state) {
  const runtimePath = resolveRuntimePath(stateDir);
  const pidPath = resolvePidPath(stateDir);
  await fs.writeFile(runtimePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.writeFile(pidPath, `${state.pid}\n`, 'utf8');
}

export async function clearRuntimeState(stateDir) {
  await Promise.allSettled([
    fs.rm(resolveRuntimePath(stateDir), { force: true }),
    fs.rm(resolvePidPath(stateDir), { force: true })
  ]);
}

export function buildRuntimeState({ version, pid, endpoint, binaryPath, logPath }) {
  return {
    version,
    pid,
    endpoint,
    binaryPath,
    logPath,
    startedAt: new Date().toISOString()
  };
}

export async function readLogTail(logPath, lineCount = 80) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw.trimEnd().split(/\r?\n/).slice(-lineCount).join('\n');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function resolvePackageRoot() {
  return path.dirname(PACKAGE_JSON_PATH);
}

export { resolveLogPath, resolvePidPath, resolveRuntimePath };
