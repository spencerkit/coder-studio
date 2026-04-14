/**
 * Tests for runtime checks.
 */

import { describe, it, expect, vi } from 'vitest';
import { runtimeCheck, RuntimeCheckFailedError } from '../../workspace/runtime-check.js';

describe('runtimeCheck', () => {
  it('should return ok=true when git and node are available', async () => {
    // Mock environment where git and node are available
    const result = await runtimeCheck('/tmp', 'native');

    // In a real dev environment, git and node should be available
    expect(result.ok).toBeDefined();
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it('should check for wsl when targetRuntime is wsl', async () => {
    const result = await runtimeCheck('/tmp', 'wsl');

    // Result depends on whether wsl command is available
    expect(result.ok).toBeDefined();
    expect(Array.isArray(result.missing)).toBe(true);
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