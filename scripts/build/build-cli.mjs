import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAIN_PACKAGE, ROOT } from '../lib/package-matrix.mjs';

const execFileAsync = promisify(execFile);
const tscCliPath = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const tsconfigPath = path.join(MAIN_PACKAGE.sourceDir, 'tsconfig.json');
const builtBinPath = path.join(MAIN_PACKAGE.buildDir, 'bin', 'coder-studio.mjs');
const sourcePackageJsonPath = path.join(MAIN_PACKAGE.sourceDir, 'package.json');
const sourceReadmePath = path.join(MAIN_PACKAGE.sourceDir, 'README.md');

await fs.rm(MAIN_PACKAGE.buildDir, { recursive: true, force: true });
await fs.mkdir(MAIN_PACKAGE.buildDir, { recursive: true });

await execFileAsync(process.execPath, [tscCliPath, '-p', tsconfigPath], {
  cwd: ROOT,
  maxBuffer: 1024 * 1024 * 16,
});

await fs.copyFile(sourcePackageJsonPath, path.join(MAIN_PACKAGE.buildDir, 'package.json'));
await fs.copyFile(sourceReadmePath, path.join(MAIN_PACKAGE.buildDir, 'README.md'));
await fs.chmod(builtBinPath, 0o755);

console.log(`built ${MAIN_PACKAGE.slug}`);
console.log(`output: ${MAIN_PACKAGE.buildDir}`);
