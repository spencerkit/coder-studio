import type { ProviderDefinition } from '@coder-studio/core';
import { z } from 'zod';
import { expect, it, vi } from 'vitest';
import { buildProviderRuntimeStatus } from '../../provider-runtime/runtime-status.js';

const testHooks: ProviderDefinition['hooks'] = {
  resolveGlobalConfigPath: () => '',
  mergeInto: (existing) => existing,
  extractManaged: () => null,
  markerVersion: 'test',
  bridgeCommand: () => [],
  parseEvent: () => null,
  events: {
    sessionStart: false,
    completion: false,
    progress: false,
  },
};

function createTestProvider(
  id: string,
  strategies: ProviderDefinition['install']['strategies'],
): ProviderDefinition {
  return {
    id,
    displayName: `${id} provider`,
    badge: id,
    capability: 'full',
    install: {
      prerequisites: ['npm'],
      manualGuideKeys: [`provider.install.${id}.manual`],
      docUrls: {
        provider: `https://example.com/${id}`,
        prerequisites: {
          npm: 'https://example.com/npm',
        },
      },
      strategies,
    },
    buildCommand: () => ({
      argv: [id],
      env: {},
      cwd: '/tmp',
    }),
    configSchema: z.object({}).passthrough(),
    defaultConfig: {},
    requiredCommands: [id],
    hooks: testHooks,
  };
}

const codexProvider = createTestProvider('codex', {
  win32: [
    {
      id: 'install-npm',
      kind: 'prerequisite',
      targetCommand: 'npm',
      requiresCommands: ['winget'],
      command: 'winget',
      args: ['install', 'OpenJS.NodeJS.LTS'],
    },
    {
      id: 'install-codex',
      kind: 'provider',
      targetCommand: 'codex',
      requiresCommands: ['npm'],
      command: 'npm',
      args: ['install', '-g', '@openai/codex'],
    },
  ],
});

const claudeProvider = createTestProvider('claude', {
  darwin: [
    {
      id: 'install-npm',
      kind: 'prerequisite',
      targetCommand: 'npm',
      requiresCommands: ['brew'],
      command: 'brew',
      args: ['install', 'node'],
    },
    {
      id: 'install-claude',
      kind: 'provider',
      targetCommand: 'claude',
      requiresCommands: ['npm'],
      command: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code'],
    },
  ],
});

it('separates missing provider commands from missing prerequisites', async () => {
  const commandExists = vi.fn(async (command: string) => command === 'winget');

  const result = await buildProviderRuntimeStatus([codexProvider], {
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

  const result = await buildProviderRuntimeStatus([claudeProvider], {
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

  const result = await buildProviderRuntimeStatus([codexProvider], {
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
