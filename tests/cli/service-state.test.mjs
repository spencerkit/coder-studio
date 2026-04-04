import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearServiceState,
  readServiceState,
  writeServiceState,
} from '../../.build/cli/lib/state.mjs';

test('service state round-trips installation metadata', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-state-'));
  const expected = {
    mode: 'managed',
    platform: 'linux-systemd-user',
    serviceName: 'com.spencer-kit.coder-studio',
    launcherPath: '/tmp/launch.sh',
    installedAt: '2026-04-04T00:00:00.000Z',
    lastInstallVersion: '0.2.6',
  };

  try {
    await writeServiceState(stateDir, expected);

    const state = await readServiceState(stateDir);
    assert.deepEqual(state, expected);

    await clearServiceState(stateDir);
    assert.equal(await readServiceState(stateDir), null);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
