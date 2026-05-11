/**
 * WorkspaceWatcher - File system watcher with throttled dirty signal.
 * Uses .gitignore for ignore rules.
 */

import { Topics } from "@coder-studio/core";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { createWatcherIgnoreFilter } from "./gitignore.js";

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
  private pendingReason: "fs_change" | "git_metadata" | null = null;
  private pendingWorktreeChanged = false;
  private readonly DEBOUNCE_MS = 200;
  private readonly MAX_WAIT_MS = 1_000;

  constructor(
    private workspaceId: string,
    rootPath: string,
    private broadcaster?: Broadcaster
  ) {
    const shouldIgnore = createWatcherIgnoreFilter(rootPath);

    this.chokidar = chokidar.watch(rootPath, {
      ignored: shouldIgnore,
      ignoreInitial: true,
      persistent: true,
    });

    this.chokidar.on("all", (_eventName, changedPath) => this.markDirty(changedPath));
  }

  /**
   * Standard debounce with max wait to avoid starvation.
   * Each file change resets the timer by 200ms. If changes
   * continue for over 1s, forces a broadcast anyway.
   */
  private markDirty(changedPath?: string): void {
    const now = Date.now();
    if (this.firstDirtyTime === null) {
      this.firstDirtyTime = now;
    }

    if (changedPath && this.isWorktreeMetadataPath(changedPath)) {
      this.pendingWorktreeChanged = true;
    }

    if (changedPath && !this.isGitMetadataPath(changedPath)) {
      this.pendingReason = "fs_change";
    } else if (changedPath && this.pendingReason !== "fs_change") {
      this.pendingReason = "git_metadata";
    } else if (this.pendingReason === null) {
      this.pendingReason = "fs_change";
    }

    const elapsed = now - this.firstDirtyTime;
    const delay = Math.min(this.DEBOUNCE_MS, Math.max(0, this.MAX_WAIT_MS - elapsed));

    if (this.dirtyTimer) {
      clearTimeout(this.dirtyTimer);
    }

    this.dirtyTimer = setTimeout(() => this.flushDirty(), delay);
  }

  private flushDirty(): void {
    this.broadcaster?.broadcast(Topics.workspaceFsDirty(this.workspaceId), {
      reason: this.pendingReason ?? "fs_change",
    });
    if (this.pendingWorktreeChanged) {
      this.broadcaster?.broadcast(Topics.workspaceGitState(this.workspaceId), {
        worktreeChanged: true,
      });
    }
    this.dirtyTimer = null;
    this.firstDirtyTime = null;
    this.pendingReason = null;
    this.pendingWorktreeChanged = false;
  }

  private isGitMetadataPath(changedPath: string): boolean {
    return changedPath.replace(/\\/g, "/").includes("/.git/");
  }

  private isWorktreeMetadataPath(changedPath: string): boolean {
    const normalized = changedPath.replace(/\\/g, "/");
    return normalized.includes("/.git/worktrees");
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
