import fs from 'node:fs/promises';
import path from 'node:path';
import { NPM_STAGE_ROOT, resolvePlatformPackageMeta, SERVER_TARGET_DIR, WEB_DIST_DIR } from '../lib/package-matrix.mjs';

const packageMeta = resolvePlatformPackageMeta();
if (!packageMeta) {
  throw new Error(`Unsupported platform for package assembly: ${process.platform}/${process.arch}`);
}

const binaryName = process.platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
const binarySource = path.join(SERVER_TARGET_DIR, 'release', binaryName);
const distSource = WEB_DIST_DIR;
const packageRoot = packageMeta.stageDir;
const binaryTarget = path.join(packageRoot, 'bin', binaryName);
const distTarget = path.join(packageRoot, 'dist');

await fs.access(binarySource);
await fs.access(distSource);
await fs.rm(packageRoot, { recursive: true, force: true });
await fs.mkdir(NPM_STAGE_ROOT, { recursive: true });
await fs.cp(packageMeta.templateDir, packageRoot, { recursive: true, force: true });
await fs.mkdir(path.dirname(binaryTarget), { recursive: true });
await fs.rm(distTarget, { recursive: true, force: true });
await fs.mkdir(distTarget, { recursive: true });
await fs.copyFile(binarySource, binaryTarget);
if (process.platform !== 'win32') {
  await fs.chmod(binaryTarget, 0o755);
}
await fs.cp(distSource, distTarget, { recursive: true, force: true });

console.log(`assembled ${packageMeta.slug}`);
console.log(`stage: ${packageRoot}`);
console.log(`binary: ${binaryTarget}`);
console.log(`dist: ${distTarget}`);
