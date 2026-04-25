/**
 * WorkspaceWatcher - File system watcher with throttled dirty signal.
 */

import { Topics } from '@coder-studio/core';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';

export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}

/**
 * Watches a workspace directory for file changes and broadcasts dirty signals.
 * Uses 100ms throttling to avoid excessive broadcasts during rapid file changes.
 */
export class WorkspaceWatcher {
  private chokidar: FSWatcher;
  private dirtyTimer: NodeJS.Timeout | null = null;

  constructor(
    private workspaceId: string,
    path: string,
    private broadcaster: Broadcaster
  ) {
    this.chokidar = chokidar.watch(path, {
      ignored: [/\.git\//, /node_modules/, /\.DS_Store/, /Thumbs\.db/],
      ignoreInitial: true,
      persistent: true,
    });

    this.chokidar.on('all', () => this.markDirty());
  }

  /**
   * Marks the workspace as dirty with throttling.
   * Broadcasts dirty signal after 100ms debounce.
   */
  private markDirty(): void {
    if (this.dirtyTimer) return; // Already pending

    this.dirtyTimer = setTimeout(() => {
      this.broadcaster.broadcast(Topics.workspaceFsDirty(this.workspaceId), {
        reason: 'fs_change',
      });
      this.dirtyTimer = null;
    }, 100); // 100ms throttle
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
