import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_MAP = {
  'linux:x64': 'coder-studio-linux-x64',
  'darwin:arm64': 'coder-studio-darwin-arm64',
  'darwin:x64': 'coder-studio-darwin-x64',
  'win32:x64': 'coder-studio-win32-x64'
};

const platformKey = `${process.platform}:${process.arch}`;
const packageSlug = PACKAGE_MAP[platformKey];
if (!packageSlug) {
  throw new Error(`Unsupported platform for package assembly: ${platformKey}`);
}

const binaryName = process.platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
const binarySource = path.join(ROOT, 'src-tauri', 'target', 'release', binaryName);
const distSource = path.join(ROOT, 'dist');
const packageRoot = path.join(ROOT, 'packages', packageSlug);
const binaryTarget = path.join(packageRoot, 'bin', binaryName);
const distTarget = path.join(packageRoot, 'dist');

await fs.access(binarySource);
await fs.access(distSource);
await fs.mkdir(path.dirname(binaryTarget), { recursive: true });
await fs.rm(distTarget, { recursive: true, force: true });
await fs.mkdir(distTarget, { recursive: true });
await fs.copyFile(binarySource, binaryTarget);
if (process.platform !== 'win32') {
  await fs.chmod(binaryTarget, 0o755);
}
await fs.cp(distSource, distTarget, { recursive: true, force: true });

console.log(`assembled ${packageSlug}`);
console.log(`binary: ${binaryTarget}`);
console.log(`dist: ${distTarget}`);
