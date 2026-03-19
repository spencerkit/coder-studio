import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
export const NPM_CMD = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 32,
    ...options
  });
}
