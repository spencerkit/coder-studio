import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  MAIN_PACKAGE,
  ROOT,
  resolvePlatformPackageMeta,
} from '../lib/package-matrix.mjs';

const execFileAsync = promisify(execFile);
const ARTIFACTS_DIR = path.join(ROOT, '.artifacts');

function npmPackPrefix(packageName) {
  return packageName.startsWith('@')
    ? packageName.slice(1).replace(/\//g, '-')
    : packageName;
}

async function resolveArtifactPath(packageName) {
  const prefix = `${npmPackPrefix(packageName)}-`;
  const entries = (await fs.readdir(ARTIFACTS_DIR))
    .filter((file) => (
      file.startsWith(prefix)
      && /^\d/.test(file.slice(prefix.length))
      && file.endsWith('.tgz')
    ))
    .sort();

  const artifact = entries.at(-1);
  if (!artifact) {
    throw new Error(`artifact_not_found:${packageName}`);
  }
  return path.join(ARTIFACTS_DIR, artifact);
}

async function resolveNpmCommand() {
  const localNpm = path.join(
    path.dirname(process.execPath),
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
  );
  try {
    await fs.access(localNpm);
    return localNpm;
  } catch {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }
}

async function installGlobalPackage(npmCommand, args) {
  await execFileAsync(npmCommand, args, {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function resolveGlobalPrefix(npmCommand) {
  const { stdout } = await execFileAsync(npmCommand, ['prefix', '-g'], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

const platformPackage = resolvePlatformPackageMeta();
if (!platformPackage) {
  throw new Error(`unsupported_platform:${process.platform}:${process.arch}`);
}

const npmCommand = await resolveNpmCommand();
const platformArtifactPath = await resolveArtifactPath(platformPackage.name);
const mainArtifactPath = await resolveArtifactPath(MAIN_PACKAGE.name);

await installGlobalPackage(npmCommand, ['install', '-g', platformArtifactPath]);
await installGlobalPackage(npmCommand, ['install', '-g', '--omit=optional', mainArtifactPath]);

const globalPrefix = await resolveGlobalPrefix(npmCommand);
const globalNodeModulesDir = path.join(globalPrefix, 'lib', 'node_modules');
const globalMainPackageDir = path.join(globalNodeModulesDir, MAIN_PACKAGE.name);
const globalPlatformPackageDir = path.join(globalNodeModulesDir, platformPackage.name);
const nestedPlatformParentDir = path.join(globalMainPackageDir, 'node_modules', '@spencer-kit');
const nestedPlatformPackageDir = path.join(nestedPlatformParentDir, platformPackage.slug);

await fs.mkdir(nestedPlatformParentDir, { recursive: true });
await fs.rm(nestedPlatformPackageDir, { recursive: true, force: true });
await fs.cp(globalPlatformPackageDir, nestedPlatformPackageDir, {
  recursive: true,
  force: true,
});
if (process.platform !== 'win32') {
  await fs.chmod(path.join(globalPlatformPackageDir, 'bin', 'coder-studio'), 0o755);
  await fs.chmod(path.join(nestedPlatformPackageDir, 'bin', 'coder-studio'), 0o755);
}

const { stdout: versionStdout } = await execFileAsync('coder-studio', ['--version'], {
  cwd: ROOT,
  maxBuffer: 1024 * 1024,
});

console.log(`installed main package: ${path.relative(ROOT, mainArtifactPath)}`);
console.log(`installed platform package: ${path.relative(ROOT, platformArtifactPath)}`);
console.log(`synced nested platform package: ${nestedPlatformPackageDir}`);
console.log(`coder-studio version: ${versionStdout.trim()}`);
