// @ts-nocheck
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_HOST, DEFAULT_PORT, resolveDataDir, resolveLogPath, resolveServiceDir, resolveServiceLauncherPath, resolveStateDir } from './config.mjs';
import { assertRuntimeBundle, resolvePlatformPackage } from './platform.mjs';
import { writeServiceLauncher } from './service-launcher.mjs';
import { createLinuxSystemdUserServiceAdapter } from './service-adapters/linux-systemd-user.mjs';
import { createMacosLaunchdAgentServiceAdapter } from './service-adapters/macos-launchd-agent.mjs';
import { clearServiceState, readPackageVersion, readServiceState, writeServiceState } from './state.mjs';

export const DEFAULT_SERVICE_NAME = 'com.spencer-kit.coder-studio';

const TEST_MANAGED_SERVICE_PLATFORM = 'test-managed-service';
const TEST_MANAGED_SERVICE_FILENAME = 'test-managed-service.json';

function resolveTestManagedServicePath(stateDir) {
  return path.join(stateDir, TEST_MANAGED_SERVICE_FILENAME);
}

async function readTestManagedServiceRecord(stateDir) {
  try {
    const raw = await fs.readFile(resolveTestManagedServicePath(stateDir), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeTestManagedServiceRecord(stateDir, record) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(resolveTestManagedServicePath(stateDir), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function removeTestManagedServiceRecord(stateDir) {
  await fs.rm(resolveTestManagedServicePath(stateDir), { force: true });
}

function buildTestManagedServiceState(stateDir, serviceName, record, version) {
  if (!record?.installed) {
    return null;
  }

  return {
    mode: 'managed',
    platform: TEST_MANAGED_SERVICE_PLATFORM,
    serviceName,
    launcherPath: resolveServiceLauncherPath(stateDir),
    installedAt: record.installedAt,
    lastInstallVersion: version,
  };
}

function createTestManagedServiceController({ env = process.env, readVersion = () => readPackageVersion(), now = () => new Date().toISOString() } = {}) {
  async function resolveRecord(input = {}) {
    const stateDir = input.stateDir || resolveStateDir(input.env || env);
    const serviceName = input.serviceName || DEFAULT_SERVICE_NAME;
    const version = await readVersion();
    let record = await readTestManagedServiceRecord(stateDir);
    if (!record) {
      record = {
        installed: true,
        active: false,
        installedAt: now(),
        lastInstallVersion: version,
      };
      await writeTestManagedServiceRecord(stateDir, record);
    }
    return { stateDir, serviceName, version, record };
  }

  async function buildStatus(input = {}) {
    const { stateDir, serviceName, version, record } = await resolveRecord(input);
    const active = Boolean(record.installed && record.active);
    const serviceState = buildTestManagedServiceState(stateDir, serviceName, record, version);

    return {
      platform: TEST_MANAGED_SERVICE_PLATFORM,
      supported: true,
      installed: Boolean(record.installed),
      active,
      loaded: active,
      enabled: Boolean(record.installed),
      stale: false,
      state: active ? 'running' : record.installed ? 'stopped' : 'not-installed',
      serviceName,
      definitionPath: null,
      serviceTarget: serviceName,
      serviceState,
      details: {
        test: true,
      },
    };
  }

  return {
    id: TEST_MANAGED_SERVICE_PLATFORM,
    platform: TEST_MANAGED_SERVICE_PLATFORM,
    supported: true,

    async install(input = {}) {
      const { stateDir, serviceName, version } = await resolveRecord(input);
      const record = {
        installed: true,
        active: false,
        installedAt: now(),
        lastInstallVersion: version,
      };
      await writeTestManagedServiceRecord(stateDir, record);
      await writeServiceState(stateDir, buildTestManagedServiceState(stateDir, serviceName, record, version));
      return {
        changed: true,
        ...(await buildStatus({ ...input, stateDir, serviceName })),
      };
    },

    async uninstall(input = {}) {
      const { stateDir, serviceName, version } = await resolveRecord(input);
      const record = {
        installed: false,
        active: false,
        installedAt: now(),
        lastInstallVersion: version,
      };
      await writeTestManagedServiceRecord(stateDir, record);
      await clearServiceState(stateDir);
      await removeServiceArtifacts(stateDir);
      return {
        changed: true,
        ...(await buildStatus({ ...input, stateDir, serviceName })),
      };
    },

    async start(input = {}) {
      const { stateDir, serviceName, version, record } = await resolveRecord(input);
      if (!record.installed) {
        throw new Error('service_not_installed');
      }
      const updated = {
        ...record,
        active: true,
      };
      await writeTestManagedServiceRecord(stateDir, updated);
      await writeServiceState(stateDir, buildTestManagedServiceState(stateDir, serviceName, updated, version));
      return {
        changed: !record.active,
        ...(await buildStatus({ ...input, stateDir, serviceName })),
      };
    },

    async stop(input = {}) {
      const { stateDir, serviceName, version, record } = await resolveRecord(input);
      if (!record.installed) {
        throw new Error('service_not_installed');
      }
      const updated = {
        ...record,
        active: false,
      };
      await writeTestManagedServiceRecord(stateDir, updated);
      await writeServiceState(stateDir, buildTestManagedServiceState(stateDir, serviceName, updated, version));
      return {
        changed: Boolean(record.active),
        ...(await buildStatus({ ...input, stateDir, serviceName })),
      };
    },

    async restart(input = {}) {
      const { stateDir, serviceName, version, record } = await resolveRecord(input);
      if (!record.installed) {
        throw new Error('service_not_installed');
      }
      const updated = {
        ...record,
        active: true,
      };
      await writeTestManagedServiceRecord(stateDir, updated);
      await writeServiceState(stateDir, buildTestManagedServiceState(stateDir, serviceName, updated, version));
      return {
        changed: true,
        ...(await buildStatus({ ...input, stateDir, serviceName })),
      };
    },

    async status(input = {}) {
      return buildStatus(input);
    },

    async isInstalled(input = {}) {
      const status = await buildStatus(input);
      return status.installed;
    },
  };
}

function createUnsupportedServiceController({ platform }) {
  return {
    id: 'unsupported',
    platform,
    supported: false,

    async install() {
      throw new Error('service_platform_not_supported');
    },

    async uninstall() {
      throw new Error('service_platform_not_supported');
    },

    async start() {
      throw new Error('service_platform_not_supported');
    },

    async stop() {
      throw new Error('service_platform_not_supported');
    },

    async restart() {
      throw new Error('service_platform_not_supported');
    },

    async status(input = {}) {
      const stateDir = input.stateDir || resolveStateDir(input.env);
      const serviceState = await readServiceState(stateDir);
      return {
        platform: this.id,
        supported: false,
        installed: false,
        active: false,
        stale: Boolean(serviceState),
        state: 'unsupported',
        serviceState,
      };
    },

    async isInstalled(input = {}) {
      const status = await this.status(input);
      return status.installed && !status.stale;
    },
  };
}

async function removeServiceArtifacts(stateDir) {
  await fs.rm(resolveServiceDir(stateDir), { recursive: true, force: true });
}

export function createPlatformServiceController({
  platform = process.platform,
  env = process.env,
  arch = process.arch,
  homeDir = os.homedir(),
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  execute,
  resolveBundle = (input) => resolvePlatformPackage(input),
  validateBundle = (bundle) => assertRuntimeBundle(bundle),
  readVersion = () => readPackageVersion(),
  now = () => new Date().toISOString(),
} = {}) {
  if (env.CODER_STUDIO_TEST_MANAGED_SERVICE === '1') {
    return createTestManagedServiceController({ env, readVersion, now });
  }

  const adapter =
    platform === 'linux'
      ? createLinuxSystemdUserServiceAdapter({ execute, homeDir })
      : platform === 'darwin'
        ? createMacosLaunchdAgentServiceAdapter({ execute, homeDir, uid })
        : null;

  if (!adapter) {
    return createUnsupportedServiceController({ platform });
  }

  function resolveOperationOptions(input = {}) {
    const stateDir = input.stateDir || resolveStateDir(input.env || env, platform);
    const resolvedEnv = input.env || env;
    return {
      ...input,
      env: resolvedEnv,
      stateDir,
      dataDir: input.dataDir || resolveDataDir(stateDir, resolvedEnv),
      host: input.host || DEFAULT_HOST,
      port: Number(input.port ?? DEFAULT_PORT),
      logPath: input.logPath || resolveLogPath(stateDir),
      serviceName: input.serviceName || DEFAULT_SERVICE_NAME,
      homeDir,
      uid,
    };
  }

  async function syncServiceBundle(options) {
    const bundle = await resolveBundle({
      env: options.env,
      platform,
      arch,
    });
    validateBundle(bundle);

    return writeServiceLauncher({
      stateDir: options.stateDir,
      binaryPath: bundle.binaryPath,
      distDir: bundle.distDir,
      host: options.host,
      port: options.port,
      dataDir: options.dataDir,
    });
  }

  async function buildStatus(options, adapterStatus = null) {
    const serviceState = await readServiceState(options.stateDir);
    const platformMatches = serviceState ? serviceState.platform === adapter.id : true;
    const resolvedServiceName = serviceState?.serviceName || options.serviceName;
    const status =
      adapterStatus || (platformMatches ? await adapter.status({ serviceName: resolvedServiceName }) : null);
    const installed = Boolean(platformMatches && status?.installed);
    const active = Boolean(installed && status?.active);
    const stale = Boolean(serviceState) && (!platformMatches || !installed);

    return {
      platform: adapter.id,
      supported: true,
      installed,
      active,
      loaded: Boolean(status?.loaded ?? active),
      enabled: Boolean(status?.enabled ?? installed),
      stale,
      state: active ? 'running' : installed ? 'stopped' : stale ? 'stale' : 'not-installed',
      serviceName: resolvedServiceName,
      definitionPath: status?.definitionPath || null,
      serviceTarget: status?.serviceTarget || null,
      serviceState,
      details: status,
    };
  }

  return {
    id: adapter.id,
    platform: adapter.id,
    supported: true,

    async install(input = {}) {
      const options = resolveOperationOptions(input);
      const launcher = await syncServiceBundle(options);
      const installResult = await adapter.install({
        serviceName: options.serviceName,
        launcherPath: launcher.launcherPath,
        stateDir: options.stateDir,
        logPath: options.logPath,
      });

      await writeServiceState(options.stateDir, {
        mode: 'managed',
        platform: adapter.id,
        serviceName: options.serviceName,
        launcherPath: launcher.launcherPath,
        installedAt: now(),
        lastInstallVersion: await readVersion(),
      });

      const status = await buildStatus(options, await adapter.status({ serviceName: options.serviceName }));
      return {
        changed: true,
        ...status,
        launcherPath: launcher.launcherPath,
        bundleManifestPath: launcher.bundleManifestPath,
        definitionPath: installResult.definitionPath || status.definitionPath,
        serviceTarget: installResult.serviceTarget || status.serviceTarget,
      };
    },

    async uninstall(input = {}) {
      const options = resolveOperationOptions(input);
      const existingState = await readServiceState(options.stateDir);
      const serviceName = existingState?.serviceName || options.serviceName;
      const uninstallResult = await adapter.uninstall({ serviceName, stateDir: options.stateDir });
      await clearServiceState(options.stateDir);
      await removeServiceArtifacts(options.stateDir);

      return {
        changed: true,
        platform: adapter.id,
        supported: true,
        installed: false,
        active: false,
        loaded: false,
        enabled: false,
        stale: false,
        state: 'not-installed',
        serviceName,
        definitionPath: uninstallResult.definitionPath || null,
        serviceTarget: uninstallResult.serviceTarget || null,
        serviceState: null,
      };
    },

    async start(input = {}) {
      const options = resolveOperationOptions(input);
      const status = await buildStatus(options);
      if (!status.installed) {
        throw new Error('service_not_installed');
      }
      await syncServiceBundle(options);
      const result = await adapter.start({ serviceName: status.serviceName, stateDir: options.stateDir });
      return {
        changed: result.changed ?? true,
        ...(await buildStatus(options)),
      };
    },

    async stop(input = {}) {
      const options = resolveOperationOptions(input);
      const status = await buildStatus(options);
      if (!status.installed && !status.stale) {
        throw new Error('service_not_installed');
      }
      const result = await adapter.stop({ serviceName: status.serviceName, stateDir: options.stateDir });
      return {
        changed: result.changed ?? status.active,
        ...(await buildStatus(options)),
      };
    },

    async restart(input = {}) {
      const options = resolveOperationOptions(input);
      const status = await buildStatus(options);
      if (!status.installed) {
        throw new Error('service_not_installed');
      }
      await syncServiceBundle(options);
      const result = await adapter.restart({ serviceName: status.serviceName, stateDir: options.stateDir });
      return {
        changed: result.changed ?? true,
        ...(await buildStatus(options)),
      };
    },

    async status(input = {}) {
      const options = resolveOperationOptions(input);
      return buildStatus(options);
    },

    async isInstalled(input = {}) {
      const status = await this.status(input);
      return status.installed && !status.stale;
    },
  };
}
