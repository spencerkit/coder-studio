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

it('reports unsupported auto-install when the installer command is missing on macOS', async () => {
  const commandExists = vi.fn(async () => false);

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: 'darwin',
    commandExists,
  });

  expect(result.providers.claude).toMatchObject({
    available: false,
    missingCommands: ['claude'],
    missingPrerequisites: ['npm'],
    autoInstallSupported: false,
    installReadiness: 'unsupported_platform',
  });
});

it('reports unsupported platform when the provider command is missing and no install strategy exists', async () => {
  const commandExists = vi.fn(async (command: string) => command === 'npm');

  const result = await buildProviderRuntimeStatus(providerRegistry, {
    platform: 'aix',
    commandExists,
  });

  expect(result.providers.codex).toMatchObject({
    available: false,
    missingCommands: ['codex'],
    missingPrerequisites: [],
    autoInstallSupported: false,
    installReadiness: 'unsupported_platform',
  });
});
