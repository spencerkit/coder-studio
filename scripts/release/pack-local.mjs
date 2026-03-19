import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ARTIFACTS_DIR = path.join(ROOT, '.artifacts');
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const PACKAGE_MAP = {
  'linux:x64': 'coder-studio-linux-x64',
  'darwin:arm64': 'coder-studio-darwin-arm64',
  'darwin:x64': 'coder-studio-darwin-x64',
  'win32:x64': 'coder-studio-win32-x64'
};

const packageSlug = PACKAGE_MAP[`${process.platform}:${process.arch}`];
if (!packageSlug) {
  throw new Error(`Unsupported platform for local pack: ${process.platform}/${process.arch}`);
}

await execFileAsync(PNPM_CMD, ['build:web'], { cwd: ROOT });
await execFileAsync(PNPM_CMD, ['build:runtime'], { cwd: ROOT, maxBuffer: 1024 * 1024 * 16 });
await execFileAsync(PNPM_CMD, ['build:packages'], { cwd: ROOT });

await fs.rm(ARTIFACTS_DIR, { recursive: true, force: true });
await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

await execFileAsync(PNPM_CMD, ['--dir', path.join('packages', packageSlug), 'pack', '--pack-destination', path.relative(path.join(ROOT, 'packages', packageSlug), ARTIFACTS_DIR)], {
  cwd: ROOT,
  maxBuffer: 1024 * 1024 * 16
});
await execFileAsync(PNPM_CMD, ['--dir', path.join('packages', 'coder-studio'), 'pack', '--pack-destination', path.relative(path.join(ROOT, 'packages', 'coder-studio'), ARTIFACTS_DIR)], {
  cwd: ROOT,
  maxBuffer: 1024 * 1024 * 16
});

const files = await fs.readdir(ARTIFACTS_DIR);
for (const file of files) {
  console.log(path.join('.artifacts', file));
}
