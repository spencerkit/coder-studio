import { afterEach, describe, expect, it } from 'vitest';
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
});
