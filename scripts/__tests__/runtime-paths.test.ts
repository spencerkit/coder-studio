import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('shared build paths', () => {
  it('uses CODER_STUDIO_RUNTIME_DIR when provided', async () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'coder-studio-runtime-paths-'));
    const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
    process.env.CODER_STUDIO_RUNTIME_DIR = runtimeDir;

    const paths = await import('../shared/paths.js?test-runtime-override');

    expect(paths.RUNTIME_DIR).toBe(resolve(runtimeDir));
    expect(paths.RUNTIME_HOOKS_DIR).toBe(resolve(runtimeDir, 'hooks'));

    if (originalRuntimeDir === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_DIR;
    } else {
      process.env.CODER_STUDIO_RUNTIME_DIR = originalRuntimeDir;
    }
    rmSync(runtimeDir, { recursive: true, force: true });
  });
});
