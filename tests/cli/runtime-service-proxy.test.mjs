import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStatus,
  openRuntime,
  restartRuntime,
  startRuntime,
  stopRuntime,
} from '../../.build/cli/lib/runtime-controller.mjs';

function createManagedServiceState(overrides = {}) {
  return {
    installed: true,
    active: false,
    stale: false,
    serviceName: 'com.spencer-kit.coder-studio',
    serviceState: {
      mode: 'managed',
      platform: 'linux-systemd-user',
      serviceName: 'com.spencer-kit.coder-studio',
      launcherPath: '/tmp/launch.sh',
      installedAt: '2026-04-04T00:00:00.000Z',
      lastInstallVersion: '0.2.6',
    },
    ...overrides,
  };
}

test('startRuntime proxies to service start when service is installed', async () => {
  const calls = [];
  let active = false;

  const result = await startRuntime({
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ active }),
      isServiceInstalled: async () => true,
      startService: async () => {
        calls.push('service-start');
        active = true;
        return { changed: true };
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-start']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'running');
  assert.equal(result.service.installed, true);
});

test('stopRuntime proxies to service stop when service is installed', async () => {
  const calls = [];
  let active = true;

  const result = await stopRuntime({
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ active }),
      isServiceInstalled: async () => true,
      stopService: async () => {
        calls.push('service-stop');
        active = false;
        return { changed: true };
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-stop']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'stopped');
});

test('restartRuntime proxies to service restart when service is installed', async () => {
  const calls = [];

  const result = await restartRuntime({
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ active: true }),
      isServiceInstalled: async () => true,
      restartService: async () => {
        calls.push('service-restart');
        return { changed: true };
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-restart']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'running');
});

test('startRuntime installs and starts managed service when auto install is enabled', async () => {
  const calls = [];
  let installed = false;
  let active = false;

  const result = await startRuntime({
    autoInstallManagedService: true,
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ installed, active }),
      isServiceInstalled: async () => installed,
      installService: async () => {
        calls.push('service-install');
        installed = true;
        return { changed: true };
      },
      startService: async () => {
        calls.push('service-start');
        active = true;
        return { changed: true };
      },
      fetchHealth: async () => {
        if (!active) {
          throw new Error('runtime_not_ready');
        }
        return { version: '0.2.6' };
      },
    },
  });

  assert.deepEqual(calls, ['service-install', 'service-start']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'running');
  assert.equal(result.service.installed, true);
});

test('restartRuntime installs and starts managed service when auto install is enabled', async () => {
  const calls = [];
  let installed = false;
  let active = false;

  const result = await restartRuntime({
    autoInstallManagedService: true,
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ installed, active }),
      isServiceInstalled: async () => installed,
      installService: async () => {
        calls.push('service-install');
        installed = true;
        return { changed: true };
      },
      startService: async () => {
        calls.push('service-start');
        active = true;
        return { changed: true };
      },
      restartService: async () => {
        calls.push('service-restart');
        active = true;
        return { changed: true };
      },
      fetchHealth: async () => {
        if (!active) {
          throw new Error('runtime_not_ready');
        }
        return { version: '0.2.6' };
      },
    },
  });

  assert.deepEqual(calls, ['service-install', 'service-start']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'running');
  assert.equal(result.service.installed, true);
});

test('getStatus surfaces stale managed service metadata without probing runtime health', async () => {
  let probed = false;

  const result = await getStatus({
    __testOverrides: {
      getServiceStatus: async () =>
        createManagedServiceState({
          installed: false,
          active: false,
          stale: true,
        }),
      fetchHealth: async () => {
        probed = true;
        return { version: '0.2.6' };
      },
    },
  });

  assert.equal(probed, false);
  assert.equal(result.managed, true);
  assert.equal(result.stale, true);
  assert.equal(result.status, 'stopped');
});

test('openRuntime starts the managed service before opening the endpoint', async () => {
  const calls = [];
  let active = false;

  const result = await openRuntime({
    openCommand: 'echo',
    __testOverrides: {
      getServiceStatus: async () => createManagedServiceState({ active }),
      isServiceInstalled: async () => true,
      startService: async () => {
        calls.push('service-start');
        active = true;
        return { changed: true };
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-start']);
  assert.equal(result.managed, true);
  assert.equal(result.status, 'running');
});

test('startRuntime falls back to direct startup with warning when systemd start fails', async () => {
  const calls = [];

  const result = await startRuntime({
    autoInstallManagedService: true,
    __testOverrides: {
      getServiceStatus: async (options) => (
        options.noService
          ? createManagedServiceState({ active: true })
          : createManagedServiceState({ active: false })
      ),
      startService: async () => {
        calls.push('service-start');
        throw new Error('systemctl_user_start_failed');
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-start']);
  assert.equal(result.status, 'running');
  assert.equal(typeof result.managed, 'boolean');
  assert.equal(Array.isArray(result.warnings), true);
  assert.match(result.warnings[0], /systemd start failed/);
});

test('restartRuntime falls back to direct startup with warning when systemd restart fails', async () => {
  const calls = [];

  const result = await restartRuntime({
    __testOverrides: {
      getServiceStatus: async (options) => (
        options.noService
          ? createManagedServiceState({ active: true })
          : createManagedServiceState({ active: true })
      ),
      restartService: async () => {
        calls.push('service-restart');
        throw new Error('systemctl_user_restart_failed');
      },
      fetchHealth: async () => ({ version: '0.2.6' }),
    },
  });

  assert.deepEqual(calls, ['service-restart']);
  assert.equal(result.status, 'running');
  assert.equal(typeof result.managed, 'boolean');
  assert.equal(Array.isArray(result.warnings), true);
  assert.match(result.warnings[0], /systemd restart failed/);
});
