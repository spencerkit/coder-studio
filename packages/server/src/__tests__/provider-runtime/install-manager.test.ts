import { describe, expect, it, vi } from 'vitest';
import { codexDefinition } from '@coder-studio/providers';
import { ProviderInstallManager } from '../../provider-runtime/install-manager.js';

describe('ProviderInstallManager', () => {
  it('builds a Windows plan that installs Node first when npm is missing', async () => {
    const commandExists = vi.fn(async (command: string) => command === 'winget');
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: 'win32',
      commandExists,
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    const job = await manager.start('codex');

    expect(job.strategyIds).toEqual(['winget-nodejs-lts', 'npm-install-codex']);
    expect(job.steps.map((step) => step.id)).toEqual([
      'install-prerequisite-npm',
      'install-provider-codex',
      'verify-provider-codex',
    ]);
  });

  it('returns a failed job with missing_prerequisite when Linux has no npm', async () => {
    const commandExists = vi.fn(async () => false);
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: 'linux',
      commandExists,
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    const job = await manager.start('codex');

    expect(job.status).toBe('failed');
    expect(job.failure).toMatchObject({
      code: 'missing_prerequisite',
      missingCommands: ['npm'],
    });
  });

  it('reuses the active job when the same provider is clicked twice', async () => {
    const pending = new Promise<{ stdout: string; stderr: string }>(() => {});
    const manager = new ProviderInstallManager([codexDefinition], {
      platform: 'darwin',
      commandExists: vi.fn(async (command: string) => command === 'npm'),
      execFile: vi.fn(() => pending),
    });

    const first = await manager.start('codex');
    const second = await manager.start('codex');

    expect(second.jobId).toBe(first.jobId);
  });
});
