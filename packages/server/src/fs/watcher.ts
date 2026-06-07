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
 * Minimal logger surface used by the watcher. Any object with these two
 * methods works (FastifyBaseLogger, console, NOOP). Kept narrow on purpose
 * so the watcher module stays runtime-agnostic.
 */
export interface WatcherLogger {
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const NOOP_WATCHER_LOGGER: WatcherLogger = {
  debug: () => {},
  warn: () => {},
};

/**
 * Filesystem error codes we consider transient when they bubble up from
 * chokidar. These happen when a watched path vanishes between detection
 * and watch setup — extremely common on Windows for `.git/index.lock`,
 * tmp files, and editor save-swap sequences.
 */
const TRANSIENT_WATCH_ERROR_CODES = new Set(["EPERM", "ENOENT", "EBUSY", "EACCES"]);

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
  private pendingAgentInstructionsChanged = false;
  private readonly logger: WatcherLogger;
  private readonly DEBOUNCE_MS = 200;
  private readonly MAX_WAIT_MS = 1_000;

  constructor(
    private workspaceId: string,
    rootPath: string,
    private broadcaster?: Broadcaster,
    logger?: WatcherLogger,
    private onDirty?: (workspaceId: string, reason: string) => void
  ) {
    this.logger = logger ?? NOOP_WATCHER_LOGGER;
    const shouldIgnore = createWatcherIgnoreFilter(rootPath);

    this.chokidar = chokidar.watch(rootPath, {
      ignored: shouldIgnore,
      ignoreInitial: true,
      persistent: true,
    });

    this.chokidar.on("all", (_eventName, changedPath) => this.markDirty(changedPath));
    // chokidar emits an `error` event with no default action. EventEmitter
    // turns an unhandled `error` into an uncaughtException, so we MUST
    // listen to keep the server alive when a watched path races a
    // git/editor process on Windows.
    this.chokidar.on("error", (err) => this.handleWatcherError(err));
  }

  private handleWatcherError(err: unknown): void {
    const error = err as NodeJS.ErrnoException;
    const code = typeof error?.code === "string" ? error.code : undefined;
    const path = typeof error?.path === "string" ? error.path : undefined;

    if (code && TRANSIENT_WATCH_ERROR_CODES.has(code)) {
      this.logger.debug(
        { workspaceId: this.workspaceId, code, path, err: error },
        "Workspace watcher skipped a transient filesystem error"
      );
      return;
    }

    this.logger.warn(
      { workspaceId: this.workspaceId, code, path, err: error },
      "Workspace watcher emitted an error"
    );
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

    if (changedPath && this.isAgentInstructionsPath(changedPath)) {
      this.pendingAgentInstructionsChanged = true;
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
    const reason = this.pendingReason ?? "fs_change";

    this.broadcaster?.broadcast(Topics.workspaceFsDirty(this.workspaceId), {
      reason,
    });
    if (this.pendingWorktreeChanged) {
      this.broadcaster?.broadcast(Topics.workspaceGitState(this.workspaceId), {
        worktreeChanged: true,
      });
    }
    if (this.pendingAgentInstructionsChanged) {
      this.onDirty?.(this.workspaceId, reason);
    }
    this.dirtyTimer = null;
    this.firstDirtyTime = null;
    this.pendingReason = null;
    this.pendingWorktreeChanged = false;
    this.pendingAgentInstructionsChanged = false;
  }

  private isGitMetadataPath(changedPath: string): boolean {
    return changedPath.replace(/\\/g, "/").includes("/.git/");
  }

  private isWorktreeMetadataPath(changedPath: string): boolean {
    const normalized = changedPath.replace(/\\/g, "/");
    return normalized.includes("/.git/worktrees");
  }

  private isAgentInstructionsPath(changedPath: string): boolean {
    return /(^|\/)\.coder-studio\/agent\.md$/.test(changedPath.replace(/\\/g, "/"));
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
