// @ts-nocheck
import fs from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPidRunning(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminateProcess(pid, { force = false } = {}) {
  if (!pid) return;

  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    await execFileAsync('taskkill', args);
    return;
  }

  process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
}

export async function waitForProcessExit(pid, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await sleep(200);
  }
  return !isPidRunning(pid);
}

export function spawnBackground(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    detached: true,
    stdio: options.stdio ?? 'ignore',
    windowsHide: true
  });
}

export function spawnForeground(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    stdio: options.stdio ?? 'inherit',
    windowsHide: true
  });
}

export async function openExternal(targetUrl, env = process.env) {
  if (env.CODER_STUDIO_OPEN_COMMAND) {
    const [command, ...extraArgs] = env.CODER_STUDIO_OPEN_COMMAND.split(' ');
    await execFileAsync(command, [...extraArgs, targetUrl]);
    return;
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', [targetUrl]);
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', targetUrl]);
    return;
  }

  await execFileAsync('xdg-open', [targetUrl]);
}

export async function ensureFile(pathname) {
  const handle = await fs.open(pathname, 'a');
  return handle;
}
