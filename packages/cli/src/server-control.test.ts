import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeRuntimeConfig } from '../../server/src/hooks/runtime-json.js';
import { ensureSingleServer, stopRunningServer } from './server-control.js';

describe('server-control', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-server-control-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();

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

    rmSync(testHomeDir, { recursive: true, force: true });
  });

  it('returns false from stop when no runtime exists', async () => {
    await expect(stopRunningServer()).resolves.toBe(false);
  });

  it('kills the running server process from runtime.json', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    writeRuntimeConfig({
      port: 4187,
      pid: 424242,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: Date.now(),
    });

    await expect(stopRunningServer()).resolves.toBe(true);

    expect(killSpy).toHaveBeenCalledWith(424242, 'SIGTERM');
  });

  it('cleans up stale runtime when pid is no longer alive', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('not found') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });

    writeRuntimeConfig({
      port: 4187,
      pid: 999999,
      token: 'test-token',
      serverInstanceId: 'server-1',
      startedAt: Date.now(),
    });

    await expect(stopRunningServer()).resolves.toBe(false);
    expect(killSpy).toHaveBeenCalledWith(999999, 'SIGTERM');
  });

  it('stops an existing instance before continuing serve startup', async () => {
    const stopSpy = vi.fn().mockResolvedValue(true);

    await ensureSingleServer(stopSpy);

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
