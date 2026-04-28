/**
 * WorkspaceWatcher - File system watcher with throttled dirty signal.
 */

import { Topics } from '@coder-studio/core';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';

const WATCHER_IGNORED_PATTERNS: RegExp[] = [
  /\.git\//,
  /node_modules/,
  /\.DS_Store/,
  /Thumbs\.db/,
  /(^|\/)\.playwright-mcp(\/|$)/,
];

export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}

/**
 * Watches a workspace directory for file changes and broadcasts dirty signals.
 * Uses standard debounce (200ms) with a 1-second max wait to avoid starvation
 * during continuous file activity.
 */
export class WorkspaceWatcher {
  private chokidar: FSWatcher;
  private dirtyTimer: NodeJS.Timeout | null = null;
  private firstDirtyTime: number | null = null;
  private readonly DEBOUNCE_MS = 200;
  private readonly MAX_WAIT_MS = 1_000;

  constructor(
    private workspaceId: string,
    path: string,
    private broadcaster: Broadcaster
  ) {
    this.chokidar = chokidar.watch(path, {
      ignored: WATCHER_IGNORED_PATTERNS,
      ignoreInitial: true,
      persistent: true,
    });

    this.chokidar.on('all', () => this.markDirty());
  }

  /**
   * Standard debounce with max wait to avoid starvation.
   * Each file change resets the timer by 200ms. If changes
   * continue for over 1s, forces a broadcast anyway.
   */
  private markDirty(): void {
    if (this.dirtyTimer) {
      if (this.firstDirtyTime && Date.now() - this.firstDirtyTime >= this.MAX_WAIT_MS) {
        clearTimeout(this.dirtyTimer);
        this.broadcaster.broadcast(Topics.workspaceFsDirty(this.workspaceId), {
          reason: 'fs_change',
        });
        this.dirtyTimer = null;
        this.firstDirtyTime = null;
      } else {
        clearTimeout(this.dirtyTimer);
        this.dirtyTimer = setTimeout(() => {
          this.dirtyTimer = null;
          this.firstDirtyTime = null;
        }, this.DEBOUNCE_MS);
      }
    } else {
      this.firstDirtyTime = Date.now();
      this.dirtyTimer = setTimeout(() => {
        this.broadcaster.broadcast(Topics.workspaceFsDirty(this.workspaceId), {
          reason: 'fs_change',
        });
        this.dirtyTimer = null;
        this.firstDirtyTime = null;
      }, this.DEBOUNCE_MS);
    }
  }

  /**
   * Stops watching and cleans up resources.
   */
  async close(): Promise<void> {
    if (this.dirtyTimer) {
      clearTimeout(this.dirtyTimer);
      this.dirtyTimer = null;
    }
    await this.chokidar.close();
  }
}
