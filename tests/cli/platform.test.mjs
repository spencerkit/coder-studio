import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePlatformPackage } from '../../.build/cli/lib/platform.mjs';

test('resolvePlatformPackage supports explicit binary and dist overrides', () => {
  const binaryOverride = '/tmp/runtime/coder-studio';
  const distOverride = '/tmp/runtime/dist';
  const result = resolvePlatformPackage({
    env: {
      CODER_STUDIO_BINARY_PATH: binaryOverride,
      CODER_STUDIO_DIST_DIR: distOverride
    },
    platform: 'linux',
    arch: 'x64'
  });

  assert.equal(result.packageName, 'override');
  assert.equal(result.binaryPath, path.resolve(binaryOverride));
  assert.equal(result.distDir, path.resolve(distOverride));
});

test('resolvePlatformPackage rejects unsupported platforms', () => {
  assert.throws(() => resolvePlatformPackage({ env: {}, platform: 'freebsd', arch: 'x64' }), /Unsupported platform/);
});
