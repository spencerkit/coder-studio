import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReleaseManifest } from './write-release-manifest.mjs';
import { assertVersionConsistency } from './check-version.mjs';
import { MAIN_PACKAGE, resolvePlatformPackageMeta, ROOT } from '../lib/package-matrix.mjs';

const execFileAsync = promisify(execFile);
const ARTIFACTS_DIR = path.join(ROOT, '.artifacts');
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const platformPackage = resolvePlatformPackageMeta();
if (!platformPackage) {
  throw new Error(`Unsupported platform for local pack: ${process.platform}/${process.arch}`);
}

await assertVersionConsistency();

await fs.rm(ARTIFACTS_DIR, { recursive: true, force: true });
await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

await execFileAsync(
  PNPM_CMD,
  ['--dir', path.relative(ROOT, platformPackage.stageDir), 'pack', '--pack-destination', path.relative(platformPackage.stageDir, ARTIFACTS_DIR)],
  {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 16,
  },
);
await execFileAsync(
  PNPM_CMD,
  ['--dir', path.relative(ROOT, MAIN_PACKAGE.sourceDir), 'pack', '--pack-destination', path.relative(MAIN_PACKAGE.sourceDir, ARTIFACTS_DIR)],
  {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 16,
  },
);

const manifest = await createReleaseManifest(ARTIFACTS_DIR);
for (const artifact of manifest.artifacts) {
  console.log(path.join('.artifacts', artifact.file));
}
console.log(path.join('.artifacts', 'release-manifest.json'));
console.log(path.join('.artifacts', 'SHA256SUMS.txt'));
