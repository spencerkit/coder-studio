import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import {
  normalizeDataDir,
  readCliConfig,
  writeCliConfig,
  getCliConfigPath,
  type CliConfig,
} from './config-store.js';

describe('config-store', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), 'cs-cli-config-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(() => {
    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }

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

  it('returns null when config file does not exist', () => {
    expect(readCliConfig()).toBeNull();
  });

  it('writes and reads host port data-dir and password config', () => {
    const config: CliConfig = {
      host: '0.0.0.0',
      port: 4186,
      dataDir: '/tmp/cs-data/coder-studio.db',
      password: 'sekrit',
    };

    writeCliConfig(config);

    expect(readCliConfig()).toEqual(config);
  });

  it('normalizes a directory input into a sqlite file path', () => {
    expect(normalizeDataDir('/tmp/cs-data')).toBe('/tmp/cs-data/coder-studio.db');
  });

  it('keeps an explicit sqlite file path unchanged', () => {
    expect(normalizeDataDir('/tmp/cs-data/custom.db')).toBe('/tmp/cs-data/custom.db');
  });

  it('does not persist ephemeral port zero in config', () => {
    writeCliConfig({ host: '127.0.0.1', port: 0, dataDir: '/tmp/cs-data/coder-studio.db', password: 'sekrit' });

    expect(JSON.parse(readFileSync(getCliConfigPath(), 'utf-8'))).toEqual({
      host: '127.0.0.1',
      dataDir: '/tmp/cs-data/coder-studio.db',
      password: 'sekrit',
    });
    expect(readCliConfig()).toEqual({
      host: '127.0.0.1',
      dataDir: '/tmp/cs-data/coder-studio.db',
      password: 'sekrit',
    });
  });
});

