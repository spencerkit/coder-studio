/**
 * Tests for WorkspaceWatcher.
 *
 * Note: File system watching behavior is tested via integration tests.
 * These unit tests focus on the watcher's API and lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chokidar, { type FSWatcher } from 'chokidar';
import { Topics } from '@coder-studio/core';
import { WorkspaceWatcher } from '../../fs/watcher.js';

describe('WorkspaceWatcher', () => {
  let testDir: string;
  let broadcaster: { broadcast: ReturnType<typeof vi.fn> };
  let watchSpy: ReturnType<typeof vi.spyOn<typeof chokidar, 'watch'>>;
  let watcherEvents: Record<string, (() => void) | undefined>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'watcher-test-'));

    broadcaster = {
      broadcast: vi.fn(),
    };

    watcherEvents = {};
    closeMock = vi.fn().mockResolvedValue(undefined);
    watchSpy = vi.spyOn(chokidar, 'watch').mockReturnValue({
      on(event: string, handler: () => void) {
        watcherEvents[event] = handler;
        return this;
      },
      close: closeMock,
    } as unknown as FSWatcher);
  });

  afterEach(async () => {
    watchSpy.mockRestore();
    try {
      await rm(testDir, { recursive: true, force: true });
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

  it('ignores Playwright MCP artifacts so local browser verification does not rebroadcast fs.dirty', () => {
    new WorkspaceWatcher('test-workspace-id', testDir, broadcaster);

    expect(watchSpy).toHaveBeenCalledTimes(1);
    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(Array.isArray(ignored)).toBe(true);
    expect(ignored?.some((pattern) => pattern instanceof RegExp && pattern.test('.playwright-mcp/page.yml'))).toBe(true);
    expect(ignored?.some((pattern) => pattern instanceof RegExp && pattern.test('workspace-terminal-after-refresh.png'))).toBe(false);
    expect(ignored?.some((pattern) => pattern instanceof RegExp && pattern.test('src/index.ts'))).toBe(false);
  });

});

