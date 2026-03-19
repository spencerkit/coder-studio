import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PLATFORM_PACKAGES = {
  'linux:x64': '@spencer-kit/coder-studio-linux-x64',
  'darwin:arm64': '@spencer-kit/coder-studio-darwin-arm64',
  'darwin:x64': '@spencer-kit/coder-studio-darwin-x64',
  'win32:x64': '@spencer-kit/coder-studio-win32-x64'
};

export function resolvePlatformPackage(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    arch = process.arch
  } = options;

  const binaryName = platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
  const binaryPath = env.CODER_STUDIO_BINARY_PATH ? path.resolve(env.CODER_STUDIO_BINARY_PATH) : '';
  const distDir = env.CODER_STUDIO_DIST_DIR ? path.resolve(env.CODER_STUDIO_DIST_DIR) : '';

  if (binaryPath) {
    return {
      packageName: 'override',
      packageDir: path.dirname(binaryPath),
      binaryPath,
      distDir,
      binaryName
    };
  }

  const packageName = PLATFORM_PACKAGES[`${platform}:${arch}`];
  if (!packageName) {
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
  }

  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageDir = path.dirname(packageJsonPath);

  return {
    packageName,
    packageDir,
    binaryPath: path.join(packageDir, 'bin', binaryName),
    distDir: path.join(packageDir, 'dist'),
    binaryName
  };
}

export function assertRuntimeBundle(bundle) {
  if (!bundle.binaryPath || !fs.existsSync(bundle.binaryPath)) {
    throw new Error(`Runtime binary not found: ${bundle.binaryPath || 'unknown'}`);
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(bundle.binaryPath, 0o755);
  }
  if (!bundle.distDir || !fs.existsSync(bundle.distDir)) {
    throw new Error(`Frontend dist not found: ${bundle.distDir || 'unknown'}`);
  }
}
