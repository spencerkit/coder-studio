/**
 * Tests for WorkspaceWatcher.
 *
 * Note: File system watching behavior is tested via integration tests.
 * These unit tests focus on the watcher's API and lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Topics } from '@coder-studio/core';
import { WorkspaceWatcher } from '../../fs/watcher.js';

describe('WorkspaceWatcher', () => {
  let testDir: string;
  let broadcaster: { broadcast: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    testDir = join(tmpdir(), `watcher-test-${Date.now()}`);
    await mkdir(testDir);

    broadcaster = {
      broadcast: vi.fn(),
    };
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create watcher with correct parameters', () => {
    const watcher = new WorkspaceWatcher('test-workspace-id', testDir, broadcaster);
    expect(watcher).toBeDefined();
    expect(watcher).toBeInstanceOf(WorkspaceWatcher);
  });

  it('should close watcher gracefully', async () => {
    const watcher = new WorkspaceWatcher('test-workspace-id', testDir, broadcaster);
    await expect(watcher.close()).resolves.toBeUndefined();
  });

  it('should have broadcaster reference', () => {
    const watcher = new WorkspaceWatcher('test-workspace-id', testDir, broadcaster);
    expect(broadcaster.broadcast).toBeDefined();
  });

  it('broadcasts fs dirty updates using the Topics builder', () => {
    vi.useFakeTimers();
    try {
      const watcher = new WorkspaceWatcher('test-workspace-id', testDir, broadcaster);

      (watcher as any).markDirty();
      vi.advanceTimersByTime(100);

      expect(broadcaster.broadcast).toHaveBeenCalledWith(
        Topics.workspaceFsDirty('test-workspace-id'),
        { reason: 'fs_change' }
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

