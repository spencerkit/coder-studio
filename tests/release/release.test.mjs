import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../../scripts/lib/package-matrix.mjs';
import {
  buildServerCargoArgs,
  resolveServerBinaryPath,
} from '../../scripts/lib/server-build.mjs';
import { assertReleaseAssets } from '../../scripts/release/check-assets.mjs';
import { assertVersionConsistency, collectReleaseVersionState } from '../../scripts/release/check-version.mjs';
import { createReleaseManifest } from '../../scripts/release/write-release-manifest.mjs';
import {
  buildDevStackRuntimeEnv,
  resetDevStackRuntimeState,
} from '../../scripts/test/dev-stack-runtime.mjs';

test('release assets required for packaging are present', async () => {
  await assertReleaseAssets();
});

test('release versions stay aligned across package manifests', async () => {
  const report = await assertVersionConsistency(ROOT);
  assert.equal(report.ok, true);

  const state = await collectReleaseVersionState(ROOT);
  assert.equal(state.mainVersion, state.rootVersion);
  assert.equal(state.mainVersion, state.cargoVersion);
});

test('server build helpers default to the native release output path', () => {
  const env = {};
  assert.equal(
    resolveServerBinaryPath({ env, platform: 'linux' }),
    path.join(ROOT, '.build', 'server', 'target', 'release', 'coder-studio'),
  );
  assert.deepEqual(
    buildServerCargoArgs({ env }),
    ['build', '--release', '--manifest-path', path.join('apps', 'server', 'Cargo.toml')],
  );
});

test('server build helpers route Linux musl builds into the target-specific output path', () => {
  const env = { CODER_STUDIO_RUST_TARGET: 'x86_64-unknown-linux-musl' };
  assert.equal(
    resolveServerBinaryPath({ env, platform: 'linux' }),
    path.join(ROOT, '.build', 'server', 'target', 'x86_64-unknown-linux-musl', 'release', 'coder-studio'),
  );
  assert.deepEqual(
    buildServerCargoArgs({ env }),
    ['build', '--release', '--manifest-path', path.join('apps', 'server', 'Cargo.toml'), '--target', 'x86_64-unknown-linux-musl'],
  );
});

test('release manifest writer emits checksums for tarballs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-release-'));

  try {
    await fs.writeFile(path.join(tempRoot, 'spencer-kit-coder-studio-0.1.0.tgz'), 'main package', 'utf8');
    await fs.writeFile(path.join(tempRoot, 'spencer-kit-coder-studio-linux-x64-0.1.0.tgz'), 'linux package', 'utf8');

    const result = await createReleaseManifest(tempRoot);
    assert.equal(result.artifacts.length, 2);

    const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(manifest.artifactCount, 2);
    assert.deepEqual(
      manifest.artifacts.map((entry) => entry.file),
      [
        'spencer-kit-coder-studio-0.1.0.tgz',
        'spencer-kit-coder-studio-linux-x64-0.1.0.tgz',
      ],
    );

    const checksums = await fs.readFile(result.checksumsPath, 'utf8');
    assert.match(checksums, /spencer-kit-coder-studio-0.1.0.tgz/);
    assert.match(checksums, /spencer-kit-coder-studio-linux-x64-0.1.0.tgz/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('dev stack runtime defaults to an isolated repo-local state dir', () => {
  const root = '/tmp/coder-studio-root';
  const result = buildDevStackRuntimeEnv(root, {});

  assert.equal(result.stateDir, path.join(root, '.tmp', 'dev-stack-runtime'));
  assert.equal(result.env.CODER_STUDIO_HOME, path.join(root, '.tmp', 'dev-stack-runtime'));
});

test('dev stack runtime reset clears prior state contents', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-dev-stack-'));
  const stateDir = path.join(tempRoot, 'state');

  try {
    await fs.mkdir(path.join(stateDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(stateDir, 'nested', 'stale.txt'), 'stale', 'utf8');

    await resetDevStackRuntimeState(stateDir);

    const entries = await fs.readdir(stateDir);
    assert.deepEqual(entries, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
