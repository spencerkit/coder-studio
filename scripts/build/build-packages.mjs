import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, resolvePlatformPackageMeta } from '../lib/package-matrix.mjs';

const packageMeta = resolvePlatformPackageMeta();
if (!packageMeta) {
  throw new Error(`Unsupported platform for package assembly: ${process.platform}/${process.arch}`);
}

const binaryName = process.platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
const binarySource = path.join(ROOT, 'src-tauri', 'target', 'release', binaryName);
const distSource = path.join(ROOT, 'dist');
const packageRoot = path.join(ROOT, 'packages', packageMeta.slug);
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

console.log(`assembled ${packageMeta.slug}`);
console.log(`binary: ${binaryTarget}`);
console.log(`dist: ${distTarget}`);
