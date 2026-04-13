import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  resolveServiceBundleManifestPath,
  resolveServiceLauncherPath,
} from '../../.build/cli/lib/config.mjs';
import { writeServiceLauncher } from '../../.build/cli/lib/service-launcher.mjs';

test('writeServiceLauncher creates a launcher and bundle manifest', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-launcher-'));
  const dataDir = path.join(stateDir, 'data');
  const runtimeDir = path.join(stateDir, 'runtime-bin');
  const initialBinaryPath = path.join(runtimeDir, 'initial-binary.sh');
  const updatedBinaryPath = path.join(runtimeDir, 'updated-binary.sh');
  const initialDistDir = path.join(stateDir, 'initial-dist');
  const updatedDistDir = path.join(stateDir, 'updated-dist');

  try {
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(initialDistDir, { recursive: true });
    await fs.mkdir(updatedDistDir, { recursive: true });
    await fs.writeFile(
      initialBinaryPath,
      '#!/bin/sh\nprintf "binary=initial dist=%s host=%s port=%s data=%s\\n" "$CODER_STUDIO_DIST_DIR" "$CODER_STUDIO_HOST" "$CODER_STUDIO_PORT" "$CODER_STUDIO_DATA_DIR"\n',
      'utf8',
    );
    await fs.writeFile(
      updatedBinaryPath,
      '#!/bin/sh\nprintf "binary=updated dist=%s host=%s port=%s data=%s\\n" "$CODER_STUDIO_DIST_DIR" "$CODER_STUDIO_HOST" "$CODER_STUDIO_PORT" "$CODER_STUDIO_DATA_DIR"\n',
      'utf8',
    );
    await fs.chmod(initialBinaryPath, 0o755);
    await fs.chmod(updatedBinaryPath, 0o755);

    const result = await writeServiceLauncher({
      stateDir,
      binaryPath: initialBinaryPath,
      distDir: initialDistDir,
      host: '127.0.0.1',
      port: 41033,
      dataDir,
    });

    assert.equal(result.launcherPath, resolveServiceLauncherPath(stateDir));
    assert.equal(result.bundleManifestPath, resolveServiceBundleManifestPath(stateDir));

    const launcher = await fs.readFile(result.launcherPath, 'utf8');
    const manifest = JSON.parse(await fs.readFile(result.bundleManifestPath, 'utf8'));

    assert.match(launcher, /^#!\/bin\/sh/m);
    assert.match(launcher, /NODE_BIN_DIR=/);
    assert.match(launcher, /export PATH="\$NODE_BIN_DIR:\$PATH"/);
    assert.match(launcher, /export CODER_STUDIO_HOST='127\.0\.0\.1'/);
    assert.match(launcher, /export CODER_STUDIO_PORT='41033'/);
    assert.match(launcher, /export CODER_STUDIO_DATA_DIR='/);
    assert.match(launcher, /service-bundle\.json/);
    assert.doesNotMatch(launcher, new RegExp(initialBinaryPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(launcher, new RegExp(initialDistDir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.deepEqual(manifest, {
      binaryPath: initialBinaryPath,
      distDir: initialDistDir,
    });

    await fs.writeFile(
      result.bundleManifestPath,
      `${JSON.stringify(
        {
          binaryPath: updatedBinaryPath,
          distDir: updatedDistDir,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const execution = spawnSync(result.launcherPath, [], {
      env: process.env,
      encoding: 'utf8',
    });

    assert.equal(execution.status, 0);
    assert.match(execution.stdout, /binary=updated/);
    assert.match(execution.stdout, new RegExp(`dist=${updatedDistDir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(execution.stdout, /host=127\.0\.0\.1/);
    assert.match(execution.stdout, /port=41033/);
    assert.match(execution.stdout, new RegExp(`data=${dataDir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
