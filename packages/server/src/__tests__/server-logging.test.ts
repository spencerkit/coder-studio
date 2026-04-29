import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runOptionalRuntimeSetup,
  writeRuntimeConfigWithWarning,
  type RuntimeSetupHooks,
  type ServerWarnLogger,
} from '../server.js';
import type { ProviderDefinition } from '@coder-studio/core';

describe('server startup logging', () => {
  const logger: ServerWarnLogger = {
    warn: vi.fn(),
  };

  const providers: ProviderDefinition[] = [];

  beforeEach(() => {
    vi.mocked(logger.warn).mockReset();
  });

  it('logs bridge deployment failures through the structured logger', async () => {
    const hooks: RuntimeSetupHooks = {
      deployBridgeScripts: vi.fn().mockRejectedValue(new Error('boom')),
      auditExternalConfigs: vi.fn().mockReturnValue({
        codex: { configPath: '/tmp/config.toml', findings: [] },
      }),
    };

    await runOptionalRuntimeSetup(hooks, providers, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
      }),
      'Failed to deploy provider bridge scripts — hooks may not fire'
    );
  });

  it('logs codex audit findings through the structured logger', async () => {
    const hooks: RuntimeSetupHooks = {
      deployBridgeScripts: vi.fn().mockResolvedValue(undefined),
      auditExternalConfigs: vi.fn().mockReturnValue({
        codex: {
          configPath: '/tmp/config.toml',
          findings: [{ startLine: 12, message: 'remove notify override' }],
        },
      }),
    };

    await runOptionalRuntimeSetup(hooks, providers, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        configPath: '/tmp/config.toml',
        startLine: 12,
        findingMessage: 'remove notify override',
      },
      'Codex config finding'
    );
  });

  it('logs runtime.json write failures through the structured logger', () => {
    const runtime = {
      port: 3000,
      pid: 1,
      token: 't',
      serverInstanceId: 's',
      startedAt: 0,
    };

    writeRuntimeConfigWithWarning(
      runtime,
      logger,
      () => {
        throw new Error('disk full');
      }
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
      }),
      'Failed to write runtime.json — provider hooks will not reach the server'
    );
  });
});
