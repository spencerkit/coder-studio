import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerRuntimeOptions } from '../server.js';
import type { ServerConfig } from '../config.js';
import { getRuntimePath, readRuntimeConfig } from '@coder-studio/core/runtime';

describe('server runtime config', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;
  let server: Server | undefined;

  const createRuntimeServer = async (
    overrides: Partial<ServerConfig> & ServerRuntimeOptions
  ): Promise<Server> => createServer(overrides);

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-server-runtime-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    const runtimePath = join(homedir(), '.coder-studio', 'runtime.json');
    if (existsSync(runtimePath)) {
      rmSync(runtimePath);
    }

    rmSync(testHomeDir, { recursive: true, force: true });

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
  });

  it('writes runtime config on startup and clears it on stop', async () => {
    server = await createRuntimeServer({
      dataDir: join(testHomeDir, 'server.db'),
      host: '127.0.0.1',
      port: 0,
      writeRuntimeConfig: true,
    });

    expect(readRuntimeConfig()).toEqual(
      expect.objectContaining({
        host: '127.0.0.1',
        pid: process.pid,
      })
    );
    expect(getRuntimePath()).toBe(
      process.env.CODER_STUDIO_RUNTIME_JSON_PATH ?? join(homedir(), '.coder-studio', 'runtime.json')
    );

    await server.stop();
    server = undefined;

    expect(readRuntimeConfig()).toBeNull();
  });
});
