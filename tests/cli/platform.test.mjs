import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlatformPackage } from '../../packages/cli/lib/platform.mjs';

test('resolvePlatformPackage supports explicit binary and dist overrides', () => {
  const result = resolvePlatformPackage({
    env: {
      CODER_STUDIO_BINARY_PATH: '/tmp/runtime/coder-studio',
      CODER_STUDIO_DIST_DIR: '/tmp/runtime/dist'
    },
    platform: 'linux',
    arch: 'x64'
  });

  assert.equal(result.packageName, 'override');
  assert.equal(result.binaryPath, '/tmp/runtime/coder-studio');
  assert.equal(result.distDir, '/tmp/runtime/dist');
});

test('resolvePlatformPackage rejects unsupported platforms', () => {
  assert.throws(() => resolvePlatformPackage({ env: {}, platform: 'freebsd', arch: 'x64' }), /Unsupported platform/);
});
