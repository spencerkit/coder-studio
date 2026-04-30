import { expect, it, vi } from 'vitest';
import { providerRegistry } from '@coder-studio/providers';
import { buildProviderRuntimeStatus } from '../../provider-runtime/runtime-status.js';

it('separates missing provider commands from missing prerequisites', async () => {
  const commandExists = vi.fn(async (command: string) => command === 'winget');

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: 'win32',
    commandExists,
  });

  expect(result.providers.codex).toMatchObject({
    available: false,
    missingCommands: ['codex'],
    missingPrerequisites: ['npm'],
    autoInstallSupported: true,
    installReadiness: 'missing_prerequisite',
  });
});
