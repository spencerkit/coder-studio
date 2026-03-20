import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../../scripts/lib/package-matrix.mjs';
import { assertVersionConsistency, collectReleaseVersionState } from '../../scripts/release/check-version.mjs';
import { createReleaseManifest } from '../../scripts/release/write-release-manifest.mjs';

test('release versions stay aligned across package manifests', async () => {
  const report = await assertVersionConsistency(ROOT);
  assert.equal(report.ok, true);

  const state = await collectReleaseVersionState(ROOT);
  assert.equal(state.mainVersion, state.rootVersion);
  assert.equal(state.mainVersion, state.cargoVersion);
  assert.equal(state.mainVersion, state.tauriVersion);
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
