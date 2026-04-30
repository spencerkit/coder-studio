import { describe, expect, it, vi } from 'vitest';
import { runtimeCheck, RuntimeCheckFailedError } from '../../workspace/runtime-check.js';

describe('runtimeCheck', () => {
  it('reports missing wsl through the shared command helper', async () => {
    const execFile = vi.fn(async (file: string) => ({
      stdout: file === 'git' ? 'git version 2.48.0\n' : 'v22.15.0\n',
      stderr: '',
    }));

    const result = await runtimeCheck('/tmp', 'wsl', {
      commandExists: async (command) => command !== 'wsl',
      execFile,
    });

    expect(result).toEqual({ ok: false, missing: ['wsl'] });
  });

  it('reports missing git and node from the version checks deterministically', async () => {
    const result = await runtimeCheck('/tmp', 'native', {
      commandExists: async () => true,
      execFile: vi.fn(async (file: string) => {
        throw new Error(`${file} unavailable`);
      }),
    });

    expect(result).toEqual({ ok: false, missing: ['git', 'node'] });
  });
});

describe('RuntimeCheckFailedError', () => {
  it('should create error with missing tools list', () => {
    const error = new RuntimeCheckFailedError(['git', 'node']);
    expect(error.name).toBe('RuntimeCheckFailedError');
    expect(error.message).toBe('Missing required tools: git, node');
    expect(error.missing).toEqual(['git', 'node']);
  });
});
