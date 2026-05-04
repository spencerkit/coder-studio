import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readRuntimeConfig,
  writeRuntimeConfig,
} from '@coder-studio/core/runtime';

const { deleteManagedServer, getManagedServerStatus, getLogPaths } = vi.hoisted(() => ({
  deleteManagedServer: vi.fn(),
  getManagedServerStatus: vi.fn(),
  getLogPaths: vi.fn(),
}));

vi.mock('./pm2-control.js', () => ({
  deleteManagedServer,
  getManagedServerStatus,
  getLogPaths,
}));

import {
  ensureSingleServer,
  getServerStatus,
  stopRunningServer,
} from './server-control.js';

describe('server-control', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
  const originalRuntimeJsonPath = process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-server-control-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    // Anchor the runtime directory directly so the test does not depend on
    // os.homedir() honoring HOME, and so any inherited env (e.g. when the
    // shell was spawned from a pm2-managed server) cannot redirect writes
    // back to the developer's real ~/.coder-studio.
    process.env.CODER_STUDIO_RUNTIME_DIR = join(testHomeDir, '.coder-studio');
    delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;

    deleteManagedServer.mockResolvedValue(false);
    getManagedServerStatus.mockResolvedValue({
      status: 'stopped',
      pm2Pid: null,
      restartCount: 0,
    });
    getLogPaths.mockReturnValue({
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalRuntimeDir === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_DIR;
    } else {
      process.env.CODER_STUDIO_RUNTIME_DIR = originalRuntimeDir;
    }

    if (originalRuntimeJsonPath === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
    } else {
      process.env.CODER_STUDIO_RUNTIME_JSON_PATH = originalRuntimeJsonPath;
    }

    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }
  });

  it('returns false from stop when pm2 app is missing and runtime is absent', async () => {
    await expect(stopRunningServer()).resolves.toBe(false);
    expect(deleteManagedServer).toHaveBeenCalledWith({ ignoreMissing: true });
  });

  it('cleans stale runtime after stop removes the pm2 app', async () => {
    deleteManagedServer.mockResolvedValue(true);

    writeRuntimeConfig({
      host: '127.0.0.1',
      port: 4187,
      pid: 424242,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: Date.now(),
    });

    await expect(stopRunningServer()).resolves.toBe(true);
    expect(readRuntimeConfig()).toBeNull();
  });

  it('maps runtime details into a running status response', async () => {
    getManagedServerStatus.mockResolvedValue({
      status: 'running',
      pm2Pid: 424242,
      restartCount: 2,
    });

    writeRuntimeConfig({
      host: '127.0.0.1',
      port: 4187,
      pid: 424242,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: 1000,
    });

    await expect(getServerStatus()).resolves.toEqual({
      status: 'running',
      pid: 424242,
      host: '127.0.0.1',
      port: 4187,
      restartCount: 2,
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
      startedAt: 1000,
    });
  });

  it('reports starting when pm2 is launching before runtime exists', async () => {
    getManagedServerStatus.mockResolvedValue({
      status: 'starting',
      pm2Pid: 424242,
      restartCount: 0,
    });

    await expect(getServerStatus()).resolves.toEqual({
      status: 'starting',
      pid: 424242,
      host: null,
      port: null,
      restartCount: 0,
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
      startedAt: null,
    });
  });

  it('cleans stale runtime when pm2 reports stopped', async () => {
    writeRuntimeConfig({
      host: '127.0.0.1',
      port: 4187,
      pid: 424242,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: 1000,
    });

    await expect(getServerStatus()).resolves.toEqual({
      status: 'stopped',
      pid: null,
      host: null,
      port: null,
      restartCount: 0,
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
      startedAt: null,
    });
    expect(readRuntimeConfig()).toBeNull();
  });

  it('maps runtime host details into a running status response', async () => {
    getManagedServerStatus.mockResolvedValue({
      status: 'running',
      pm2Pid: 424242,
      restartCount: 2,
    });

    writeRuntimeConfig({
      host: '0.0.0.0',
      port: 4187,
      pid: 424242,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: 1000,
    });

    await expect(getServerStatus()).resolves.toEqual({
      status: 'running',
      pid: 424242,
      host: '0.0.0.0',
      port: 4187,
      restartCount: 2,
      outFile: '/tmp/server.out.log',
      errFile: '/tmp/server.err.log',
      startedAt: 1000,
    });
  });

  it('stops an existing instance before continuing serve startup', async () => {
    const stopSpy = vi.fn().mockResolvedValue(true);

    await ensureSingleServer(stopSpy);

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
