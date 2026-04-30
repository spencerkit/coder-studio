import { describe, expect, it, vi } from 'vitest';
import { runtimeCheck, RuntimeCheckFailedError } from '../../workspace/runtime-check.js';

describe('runtimeCheck', () => {
  it('reports missing wsl through the shared command helper fallback', async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === 'git') {
        return { stdout: 'git version 2.48.0\n', stderr: '' };
      }

      if (file === 'node') {
        return { stdout: 'v22.15.0\n', stderr: '' };
      }

      if (file === 'where' && args[0] === 'wsl') {
        throw new Error('wsl unavailable');
      }

      return { stdout: '', stderr: '' };
    });

    const result = await runtimeCheck('/tmp', 'wsl', {
      platform: 'win32',
      execFile,
    });

    expect(result).toEqual({ ok: false, missing: ['wsl'] });
    expect(execFile).toHaveBeenCalledWith('where', ['wsl']);
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
