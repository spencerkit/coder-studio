import { afterEach, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { parseServerConfig } from './config.js';

describe('parseServerConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to port 4173 when PORT is not set', () => {
    delete process.env.PORT;

    const config = parseServerConfig();

    expect(config.port).toBe(4173);
  });

  it('prefers explicit overrides over environment defaults', () => {
    process.env.PORT = '4173';

    const config = parseServerConfig({ port: 8080 });

    expect(config.port).toBe(8080);
  });

  it('uses the temp sqlite file by default outside production', () => {
    delete process.env.NODE_ENV;
    delete process.env.DATA_DIR;

    const config = parseServerConfig();

    expect(config.dataDir).toBe(join(tmpdir(), 'coder-studio-dev.db'));
  });

  it('uses a stable user data sqlite path by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATA_DIR;

    const config = parseServerConfig();

    expect(config.dataDir).toBe(join(homedir(), '.coder-studio', 'data', 'coder-studio.db'));
  });
});
