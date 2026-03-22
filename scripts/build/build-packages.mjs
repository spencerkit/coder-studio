import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MAIN_PACKAGE,
  NPM_STAGE_ROOT,
  resolvePlatformPackageMeta,
  WEB_DIST_DIR,
} from '../lib/package-matrix.mjs';
import { resolveServerBinaryPath } from '../lib/server-build.mjs';

const packageMeta = resolvePlatformPackageMeta();
if (!packageMeta) {
  throw new Error(`Unsupported platform for package assembly: ${process.platform}/${process.arch}`);
}

const binaryName = process.platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
const binarySource = resolveServerBinaryPath();
const distSource = WEB_DIST_DIR;
const packageRoot = packageMeta.stageDir;
const binaryTarget = path.join(packageRoot, 'bin', binaryName);
const distTarget = path.join(packageRoot, 'dist');
const mainPackageRoot = MAIN_PACKAGE.stageDir;
const mainPackageBinSource = path.join(MAIN_PACKAGE.buildDir, 'bin');
const mainPackageLibSource = path.join(MAIN_PACKAGE.buildDir, 'lib');

async function stageMainPackage() {
  await fs.access(path.join(mainPackageBinSource, 'coder-studio.mjs'));
  await fs.access(path.join(mainPackageLibSource, 'cli.mjs'));
  await fs.rm(mainPackageRoot, { recursive: true, force: true });
  await fs.mkdir(mainPackageRoot, { recursive: true });
  await fs.copyFile(
    path.join(MAIN_PACKAGE.sourceDir, 'package.json'),
    path.join(mainPackageRoot, 'package.json'),
  );
  await fs.copyFile(
    path.join(MAIN_PACKAGE.sourceDir, 'README.md'),
    path.join(mainPackageRoot, 'README.md'),
  );
  await fs.cp(mainPackageBinSource, path.join(mainPackageRoot, 'bin'), {
    recursive: true,
    force: true,
  });
  await fs.cp(mainPackageLibSource, path.join(mainPackageRoot, 'lib'), {
    recursive: true,
    force: true,
  });
}

await fs.access(binarySource);
await fs.access(distSource);
await stageMainPackage();
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

console.log(`assembled ${MAIN_PACKAGE.slug}`);
console.log(`stage: ${mainPackageRoot}`);
console.log(`assembled ${packageMeta.slug}`);
console.log(`stage: ${packageRoot}`);
console.log(`binary: ${binaryTarget}`);
console.log(`dist: ${distTarget}`);
