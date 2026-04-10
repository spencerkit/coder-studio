import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlatformServiceController } from '../../.build/cli/lib/service-controller.mjs';
import { readServiceState } from '../../.build/cli/lib/state.mjs';

async function createFakeRuntimeBundle(rootDir) {
  const runtimeDir = path.join(rootDir, 'runtime');
  const distDir = path.join(rootDir, 'dist');
  const binaryPath = path.join(runtimeDir, 'coder-studio');

  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(binaryPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(binaryPath, 0o755);

  return { binaryPath, distDir };
}

test('createPlatformServiceController selects linux systemd user adapter', async () => {
  const controller = createPlatformServiceController({ platform: 'linux' });
  assert.equal(controller.id, 'linux-systemd-user');
});

test('createPlatformServiceController selects macos launchd agent adapter', async () => {
  const controller = createPlatformServiceController({ platform: 'darwin', uid: 501 });
  assert.equal(controller.id, 'macos-launchd-agent');
});

test('createPlatformServiceController falls back to unsupported adapter', async () => {
  const controller = createPlatformServiceController({ platform: 'win32' });
  assert.equal(controller.id, 'unsupported');
});

test('linux controller installs state and unit metadata through the adapter', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-controller-linux-'));
  const homeDir = path.join(tempRoot, 'home');
  const stateDir = path.join(tempRoot, 'state');
  const dataDir = path.join(stateDir, 'data');
  const calls = [];
  const bundle = await createFakeRuntimeBundle(tempRoot);

  const execute = async (command, args) => {
    calls.push([command, ...args]);

    if (args[1] === 'show') {
      return {
        code: 0,
        stdout: 'loaded\ninactive\nenabled\n',
        stderr: '',
      };
    }

    return { code: 0, stdout: '', stderr: '' };
  };

  try {
    const controller = createPlatformServiceController({
      platform: 'linux',
      homeDir,
      execute,
      resolveBundle: () => bundle,
      validateBundle: () => undefined,
      readVersion: async () => '0.2.6',
      now: () => '2026-04-04T00:00:00.000Z',
    });

    const result = await controller.install({
      stateDir,
      dataDir,
      host: '127.0.0.1',
      port: 41033,
      serviceName: 'com.example.coder-studio',
    });

    const serviceState = await readServiceState(stateDir);
    const unitPath = path.join(homeDir, '.config', 'systemd', 'user', 'com.example.coder-studio.service');
    const launcherPath = path.join(stateDir, 'service', 'launch.sh');
    const unitContents = await fs.readFile(unitPath, 'utf8');

    assert.equal(result.platform, 'linux-systemd-user');
    assert.equal(result.installed, true);
    assert.equal(result.active, false);
    assert.equal(result.serviceState.serviceName, 'com.example.coder-studio');
    assert.equal(serviceState.platform, 'linux-systemd-user');
    assert.equal(serviceState.launcherPath, launcherPath);
    assert.match(unitContents, /Restart=on-failure/);
    assert.match(unitContents, /ExecStart=.*launch\.sh/);
    assert.match(unitContents, /WorkingDirectory=.*state/);
    assert.deepEqual(calls, [
      ['systemctl', '--user', 'is-system-running'],
      ['systemctl', '--user', 'status', '--no-pager'],
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', 'com.example.coder-studio.service'],
      [
        'systemctl',
        '--user',
        'show',
        'com.example.coder-studio.service',
        '--property=LoadState',
        '--property=ActiveState',
        '--property=UnitFileState',
        '--value',
      ],
    ]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('controller marks service metadata as stale when platform service is missing', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-controller-stale-'));
  const stateDir = path.join(tempRoot, 'state');

  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'service.json'),
      `${JSON.stringify(
        {
          mode: 'managed',
          platform: 'linux-systemd-user',
          serviceName: 'com.example.coder-studio',
          launcherPath: path.join(stateDir, 'service', 'launch.sh'),
          installedAt: '2026-04-04T00:00:00.000Z',
          lastInstallVersion: '0.2.6',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const controller = createPlatformServiceController({
      platform: 'linux',
      homeDir: path.join(tempRoot, 'home'),
      execute: async () => ({
        code: 0,
        stdout: 'not-found\ninactive\ndisabled\n',
        stderr: '',
      }),
    });

    const status = await controller.status({ stateDir });
    assert.equal(status.installed, false);
    assert.equal(status.stale, true);
    assert.equal(status.state, 'stale');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('macos controller routes start restart stop and uninstall through launchctl', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-controller-macos-'));
  const homeDir = path.join(tempRoot, 'home');
  const stateDir = path.join(tempRoot, 'state');
  const dataDir = path.join(stateDir, 'data');
  const calls = [];
  let loaded = false;
  const bundle = await createFakeRuntimeBundle(tempRoot);

  const execute = async (command, args) => {
    calls.push([command, ...args]);

    if (args[0] === 'print') {
      return loaded ? { code: 0, stdout: 'service = running\n', stderr: '' } : { code: 1, stdout: '', stderr: 'not found' };
    }
    if (args[0] === 'bootstrap') {
      loaded = true;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'kickstart') {
      loaded = true;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'bootout') {
      loaded = false;
      return { code: 0, stdout: '', stderr: '' };
    }

    return { code: 0, stdout: '', stderr: '' };
  };

  try {
    const controller = createPlatformServiceController({
      platform: 'darwin',
      homeDir,
      uid: 501,
      execute,
      resolveBundle: () => bundle,
      validateBundle: () => undefined,
      readVersion: async () => '0.2.6',
      now: () => '2026-04-04T00:00:00.000Z',
    });

    await controller.install({
      stateDir,
      dataDir,
      host: '127.0.0.1',
      port: 41033,
      serviceName: 'com.example.coder-studio',
    });

    const started = await controller.start({ stateDir, dataDir });
    const restarted = await controller.restart({ stateDir, dataDir });
    const stopped = await controller.stop({ stateDir, dataDir });
    const removed = await controller.uninstall({ stateDir, dataDir });

    assert.equal(started.active, true);
    assert.equal(restarted.active, true);
    assert.equal(stopped.active, false);
    assert.equal(removed.installed, false);
    assert.equal(await readServiceState(stateDir), null);
    assert.deepEqual(
      calls.filter((entry) => entry[1] !== 'print'),
      [
        ['launchctl', 'bootstrap', 'gui/501', path.join(homeDir, 'Library', 'LaunchAgents', 'com.example.coder-studio.plist')],
        ['launchctl', 'kickstart', '-k', 'gui/501/com.example.coder-studio'],
        ['launchctl', 'bootout', 'gui/501/com.example.coder-studio'],
      ],
    );
    assert.ok(calls.filter((entry) => entry[1] === 'print').length >= 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
