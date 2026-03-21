import path from 'node:path';
import { ROOT, SERVER_APP_DIR, SERVER_TARGET_DIR } from './package-matrix.mjs';

export function resolveRustTarget({ env = process.env } = {}) {
  const value = env.CODER_STUDIO_RUST_TARGET;
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function resolveServerBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'coder-studio.exe' : 'coder-studio';
}

export function resolveServerBinaryPath({
  env = process.env,
  platform = process.platform,
  profile = 'release',
} = {}) {
  const binaryName = resolveServerBinaryName(platform);
  const rustTarget = resolveRustTarget({ env });
  if (rustTarget) {
    return path.join(SERVER_TARGET_DIR, rustTarget, profile, binaryName);
  }
  return path.join(SERVER_TARGET_DIR, profile, binaryName);
}

export function buildServerCargoArgs({
  env = process.env,
  profile = 'release',
  manifestPath = path.join(SERVER_APP_DIR, 'Cargo.toml'),
} = {}) {
  const args = ['build'];
  if (profile === 'release') {
    args.push('--release');
  } else {
    args.push('--profile', profile);
  }
  args.push('--manifest-path', path.relative(ROOT, manifestPath));

  const rustTarget = resolveRustTarget({ env });
  if (rustTarget) {
    args.push('--target', rustTarget);
  }

  return args;
}
