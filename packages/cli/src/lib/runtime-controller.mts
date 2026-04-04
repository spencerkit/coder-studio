// @ts-nocheck
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { buildEndpoint, DEFAULT_HOST, DEFAULT_LOG_TAIL_LINES, DEFAULT_PORT, resolveDataDir, resolveLogPath, resolveStateDir } from './config.mjs';
import { fetchHealth, requestShutdown, waitForHealth } from './http.mjs';
import { assertRuntimeBundle, resolvePlatformPackage } from './platform.mjs';
import { ensureFile, isPidRunning, openExternal, spawnBackground, spawnForeground, terminateProcess, waitForProcessExit } from './process-utils.mjs';
import { createPlatformServiceController } from './service-controller.mjs';
import { buildRuntimeState, clearRuntimeState, ensureStateDirs, readPackageVersion, readRuntimeState, readLogTail, writeRuntimeState } from './state.mjs';

const DEFAULT_START_TIMEOUT_MS = 15000;

function resolveStartTimeout(input, env) {
  const candidate = input ?? env?.CODER_STUDIO_START_TIMEOUT_MS;
  const timeout = Number(candidate);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_START_TIMEOUT_MS;
}

function resolveOptions(input = {}) {
  const stateDir = input.stateDir || resolveStateDir(input.env);
  const env = input.env || process.env;
  const host = input.host || DEFAULT_HOST;
  const port = Number(input.port ?? DEFAULT_PORT);
  const endpoint = input.endpoint || buildEndpoint(host, port);
  const dataDir = input.dataDir || resolveDataDir(stateDir, env);
  const logPath = input.logPath || resolveLogPath(stateDir);
  const tailLines = Number(input.tailLines ?? DEFAULT_LOG_TAIL_LINES);
  const timeoutMs = resolveStartTimeout(input.timeoutMs, env);
  return {
    ...input,
    stateDir,
    host,
    port,
    endpoint,
    dataDir,
    logPath,
    timeoutMs,
    tailLines: Number.isFinite(tailLines) && tailLines > 0 ? tailLines : DEFAULT_LOG_TAIL_LINES,
    openCommand: input.openCommand || null,
    env
  };
}

function isRuntimeActive(status) {
  return status.status === 'running' || status.status === 'degraded';
}

function resolveManagedServiceInput(options) {
  return {
    stateDir: options.stateDir,
    dataDir: options.dataDir,
    host: options.host,
    port: options.port,
    logPath: options.logPath,
    env: options.env
  };
}

function resolveServiceController(options) {
  return options.__testOverrides?.serviceController || createPlatformServiceController({ env: options.env });
}

async function getManagedServiceStatus(options) {
  if (typeof options.__testOverrides?.getServiceStatus === 'function') {
    return options.__testOverrides.getServiceStatus(options);
  }
  const controller = resolveServiceController(options);
  return controller.status(resolveManagedServiceInput(options));
}

async function isManagedServiceInstalled(options) {
  if (typeof options.__testOverrides?.isServiceInstalled === 'function') {
    return options.__testOverrides.isServiceInstalled(options);
  }
  const status = await getManagedServiceStatus(options);
  return Boolean(status?.installed && !status?.stale);
}

async function startManagedService(options) {
  if (typeof options.__testOverrides?.startService === 'function') {
    return options.__testOverrides.startService(options);
  }
  const controller = resolveServiceController(options);
  return controller.start(resolveManagedServiceInput(options));
}

async function stopManagedService(options) {
  if (typeof options.__testOverrides?.stopService === 'function') {
    return options.__testOverrides.stopService(options);
  }
  const controller = resolveServiceController(options);
  return controller.stop(resolveManagedServiceInput(options));
}

async function restartManagedService(options) {
  if (typeof options.__testOverrides?.restartService === 'function') {
    return options.__testOverrides.restartService(options);
  }
  const controller = resolveServiceController(options);
  return controller.restart(resolveManagedServiceInput(options));
}

async function fetchRuntimeHealth(endpoint, options) {
  if (typeof options.__testOverrides?.fetchHealth === 'function') {
    return options.__testOverrides.fetchHealth(endpoint, options);
  }
  return fetchHealth(endpoint);
}

async function probeManagedStatus(options) {
  const runtime = await readRuntimeState(options.stateDir);
  if (!runtime) return null;

  const endpoint = runtime.endpoint || options.endpoint;
  const pid = Number(runtime.pid || 0);
  const running = pid > 0 && isPidRunning(pid);

  if (!running) {
    await clearRuntimeState(options.stateDir);
    return {
      status: 'stopped',
      managed: true,
      stale: true,
      endpoint,
      pid,
      runtime
    };
  }

  try {
    const health = await fetchHealth(endpoint);
    return {
      status: 'running',
      managed: true,
      stale: false,
      endpoint,
      pid,
      runtime,
      health
    };
  } catch (error) {
    return {
      status: 'degraded',
      managed: true,
      stale: false,
      endpoint,
      pid,
      runtime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function buildManagedRuntimeStatus(options, serviceStatus = null) {
  const managedService = serviceStatus || await getManagedServiceStatus(options);
  if (!managedService || (!managedService.installed && !managedService.stale && !managedService.serviceState)) {
    return null;
  }

  const base = {
    managed: true,
    stale: Boolean(managedService.stale),
    endpoint: options.endpoint,
    pid: null,
    runtime: null,
    stateDir: options.stateDir,
    logPath: options.logPath,
    dataDir: options.dataDir,
    service: managedService,
    serviceState: managedService.serviceState ?? null
  };

  if (!managedService.active) {
    return {
      status: 'stopped',
      ...base
    };
  }

  try {
    const health = await fetchRuntimeHealth(options.endpoint, options);
    return {
      status: 'running',
      ...base,
      health
    };
  } catch (error) {
    return {
      status: 'degraded',
      ...base,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getStatus(input = {}) {
  const options = resolveOptions(input);
  const managedService = await getManagedServiceStatus(options);
  if (managedService && (managedService.installed || managedService.stale || managedService.serviceState)) {
    const status = await buildManagedRuntimeStatus(options, managedService);
    if (status) {
      return status;
    }
  }

  const managed = await probeManagedStatus(options);
  if (managed) {
    return {
      ...managed,
      stateDir: options.stateDir,
      logPath: managed.runtime?.logPath || options.logPath,
      dataDir: options.dataDir
    };
  }

  try {
    const health = await fetchHealth(options.endpoint);
    return {
      status: 'running',
      managed: false,
      stale: false,
      endpoint: options.endpoint,
      pid: null,
      runtime: null,
      health,
      stateDir: options.stateDir,
      logPath: options.logPath,
      dataDir: options.dataDir
    };
  } catch (error) {
    return {
      status: 'stopped',
      managed: false,
      stale: false,
      endpoint: options.endpoint,
      pid: null,
      runtime: null,
      error: error instanceof Error ? error.message : String(error),
      stateDir: options.stateDir,
      logPath: options.logPath,
      dataDir: options.dataDir
    };
  }
}

async function waitForReady(endpoint, pid, timeoutMs, options = null) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (pid && !isPidRunning(pid)) {
      throw new Error('runtime_exited_early');
    }
    try {
      if (typeof options?.__testOverrides?.waitForReady === 'function') {
        return await options.__testOverrides.waitForReady(endpoint, { pid, timeoutMs, options });
      }
      if (typeof options?.__testOverrides?.fetchHealth === 'function') {
        return await options.__testOverrides.fetchHealth(endpoint, options);
      }
      return await waitForHealth(endpoint, { timeoutMs: 500, intervalMs: 200 });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('health_timeout');
}

function buildChildEnv(options, bundle) {
  return {
    ...process.env,
    ...options.env,
    CODER_STUDIO_HOST: options.host,
    CODER_STUDIO_PORT: String(options.port),
    CODER_STUDIO_DATA_DIR: options.dataDir,
    CODER_STUDIO_DIST_DIR: bundle.distDir
  };
}

async function writeStateForPid(options, bundle, pid) {
  const version = await readPackageVersion();
  const state = buildRuntimeState({
    version,
    pid,
    endpoint: options.endpoint,
    binaryPath: bundle.binaryPath,
    logPath: options.logPath
  });
  await writeRuntimeState(options.stateDir, state);
  return state;
}

async function cleanupIfManagedPid(options, pid) {
  const runtime = await readRuntimeState(options.stateDir);
  if (runtime && Number(runtime.pid) === Number(pid)) {
    await clearRuntimeState(options.stateDir);
  }
}

export async function startRuntime(input = {}) {
  const options = resolveOptions(input);
  if (await isManagedServiceInstalled(options)) {
    const current = await getStatus(options);
    if (isRuntimeActive(current)) {
      return {
        changed: false,
        ...current
      };
    }

    const startResult = await startManagedService(options);
    await waitForReady(options.endpoint, null, options.timeoutMs, options);
    return {
      changed: startResult?.changed ?? true,
      ...(await getStatus(options))
    };
  }

  await ensureStateDirs(options.stateDir, options.dataDir);

  const current = await getStatus(options);
  if (current.status === 'running' || current.status === 'degraded') {
    return {
      changed: false,
      ...current
    };
  }

  const bundle = resolvePlatformPackage({ env: options.env });
  assertRuntimeBundle(bundle);

  const env = buildChildEnv(options, bundle);

  if (options.foreground) {
    const child = spawnForeground(bundle.binaryPath, [], {
      cwd: options.stateDir,
      env
    });
    if (!child.pid) {
      throw new Error('runtime_pid_missing');
    }

    const exitPromise = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
    const errorPromise = once(child, 'error').then(([error]) => { throw error; });

    await Promise.race([
      waitForReady(options.endpoint, child.pid, options.timeoutMs, options),
      exitPromise.then(() => {
        throw new Error('runtime_exited_early');
      }),
      errorPromise
    ]);

    await writeStateForPid(options, bundle, child.pid);
    if (typeof options.onReady === 'function') {
      await options.onReady({ endpoint: options.endpoint, pid: child.pid, logPath: options.logPath });
    }

    const forward = (signal) => {
      try {
        child.kill(signal);
      } catch {
        // Ignore when already stopped.
      }
    };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);

    try {
      const { code, signal } = await Promise.race([exitPromise, errorPromise]);
      await cleanupIfManagedPid(options, child.pid);
      return {
        changed: true,
        status: code === 0 ? 'stopped' : 'failed',
        endpoint: options.endpoint,
        pid: child.pid,
        exitCode: code,
        signal
      };
    } finally {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
    }
  }

  const logHandle = await ensureFile(options.logPath);
  const child = spawnBackground(bundle.binaryPath, [], {
    cwd: options.stateDir,
    env,
    stdio: ['ignore', logHandle.fd, logHandle.fd]
  });
  if (!child.pid) {
    await logHandle.close();
    throw new Error('runtime_pid_missing');
  }
  child.unref();
  await logHandle.close();
  const exitPromise = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  const errorPromise = once(child, 'error').then(([error]) => {
    throw error;
  });

  try {
    await Promise.race([
      waitForReady(options.endpoint, child.pid, options.timeoutMs, options),
      exitPromise.then(() => {
        throw new Error('runtime_exited_early');
      }),
      errorPromise
    ]);
    await writeStateForPid(options, bundle, child.pid);
    return {
      changed: true,
      status: 'running',
      endpoint: options.endpoint,
      pid: child.pid,
      logPath: options.logPath,
      stateDir: options.stateDir,
      dataDir: options.dataDir
    };
  } catch (error) {
    await Promise.allSettled([
      terminateProcess(child.pid, { force: false }),
      clearRuntimeState(options.stateDir)
    ]);
    throw error;
  }
}

export async function stopRuntime(input = {}) {
  const options = resolveOptions(input);
  if (await isManagedServiceInstalled(options)) {
    const current = await getStatus(options);
    if (!isRuntimeActive(current)) {
      return {
        changed: false,
        ...current
      };
    }

    const stopResult = await stopManagedService(options);
    return {
      changed: stopResult?.changed ?? true,
      ...(await getStatus(options))
    };
  }

  const status = await getStatus(options);
  if (status.status === 'stopped') {
    return {
      changed: false,
      ...status
    };
  }

  let shutdownError = null;
  try {
    await requestShutdown(status.endpoint);
  } catch (error) {
    shutdownError = error instanceof Error ? error.message : String(error);
  }

  if (status.pid) {
    const gracefulExit = await waitForProcessExit(status.pid, 8000);
    if (!gracefulExit) {
      try {
        await terminateProcess(status.pid, { force: false });
      } catch {
        // Ignore fallback kill failure here and try force next.
      }
      const terminated = await waitForProcessExit(status.pid, 4000);
      if (!terminated) {
        await terminateProcess(status.pid, { force: true });
        await waitForProcessExit(status.pid, 2000);
      }
    }
  }

  await clearRuntimeState(options.stateDir);
  return {
    changed: true,
    status: 'stopped',
    endpoint: status.endpoint,
    pid: status.pid,
    shutdownError
  };
}

export async function restartRuntime(input = {}) {
  const options = resolveOptions(input);
  if (await isManagedServiceInstalled(options)) {
    const restartResult = await restartManagedService(options);
    await waitForReady(options.endpoint, null, options.timeoutMs, options);
    return {
      changed: restartResult?.changed ?? true,
      ...(await getStatus(options))
    };
  }

  await stopRuntime(input);
  return startRuntime(input);
}

export async function openRuntime(input = {}) {
  const options = resolveOptions(input);
  if (await isManagedServiceInstalled(options)) {
    const status = await getStatus(options);
    const active = isRuntimeActive(status) ? status : await startRuntime(options);
    const openEnv = options.openCommand ? { ...options.env, CODER_STUDIO_OPEN_COMMAND: options.openCommand } : options.env;
    await openExternal(active.endpoint, openEnv);
    return active;
  }

  const status = await getStatus(options);
  const running = status.status === 'running' || status.status === 'degraded';
  const active = running ? status : await startRuntime(options);
  const openEnv = options.openCommand ? { ...options.env, CODER_STUDIO_OPEN_COMMAND: options.openCommand } : options.env;
  await openExternal(active.endpoint, openEnv);
  return active;
}

export async function readRuntimeLogs(input = {}) {
  const options = resolveOptions(input);
  return readLogTail(options.logPath, input.lines ?? options.tailLines ?? DEFAULT_LOG_TAIL_LINES);
}

export async function doctorRuntime(input = {}) {
  const options = resolveOptions(input);
  const bundle = (() => {
    try {
      return resolvePlatformPackage({ env: options.env });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })();
  const status = await getStatus(options);
  const logExists = await fs.stat(options.logPath).then(() => true).catch(() => false);
  const runtime = await readRuntimeState(options.stateDir);

  return {
    status,
    bundle,
    stateDir: options.stateDir,
    dataDir: options.dataDir,
    logPath: options.logPath,
    logExists,
    runtime
  };
}
