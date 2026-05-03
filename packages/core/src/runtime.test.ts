import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteRuntimeConfig,
  getRuntimeDir,
  getRuntimePath,
  readRuntimeConfig,
  writeRuntimeConfig,
  type RuntimeConfig,
} from './runtime.js';

describe('runtime config', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-runtime-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(() => {
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

  it('prefers explicit runtime dir and path overrides', () => {
    const runtimeDir = join(testHomeDir, 'custom-runtime');
    const runtimePath = join(runtimeDir, 'alt-runtime.json');
    process.env.CODER_STUDIO_RUNTIME_DIR = runtimeDir;
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = runtimePath;

    expect(getRuntimeDir()).toBe(runtimeDir);
    expect(getRuntimePath()).toBe(runtimePath);

    delete process.env.CODER_STUDIO_RUNTIME_DIR;
    delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  });

  it('writes, reads, and deletes the runtime file', () => {
    const config: RuntimeConfig = {
      host: '127.0.0.1',
      port: 4173,
      pid: 1234,
      token: 'token',
      serverInstanceId: 'server-1',
      startedAt: 1,
    };

    expect(readRuntimeConfig()).toBeNull();
    writeRuntimeConfig(config);
    expect(readRuntimeConfig()).toEqual(config);
    expect(getRuntimePath()).toBe(join(homedir(), '.coder-studio', 'runtime.json'));
    deleteRuntimeConfig();
    expect(readRuntimeConfig()).toBeNull();
  });

  it('defaults host to localhost when reading a legacy runtime file', () => {
    const runtimeDir = join(homedir(), '.coder-studio');
    if (!existsSync(runtimeDir)) {
      mkdirSync(runtimeDir, { recursive: true });
    }

    writeFileSync(
      getRuntimePath(),
      JSON.stringify({
        port: 4173,
        pid: 1234,
        token: 'token',
        serverInstanceId: 'server-1',
        startedAt: 1,
      }),
      'utf-8'
    );

    expect(readRuntimeConfig()).toEqual({
      host: 'localhost',
      port: 4173,
      pid: 1234,
      token: 'token',
      serverInstanceId: 'server-1',
      startedAt: 1,
    });
  });
});
