/**
 * Tests for WorkspaceWatcher.
 *
 * Note: File system watching behavior is tested via integration tests.
 * These unit tests focus on the watcher's API and lifecycle.
 */

import { Topics } from "@coder-studio/core";
import chokidar, { type FSWatcher } from "chokidar";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceWatcher } from "../../fs/watcher.js";

type WatchEventHandler = (eventName?: string, changedPath?: string) => void;

describe("WorkspaceWatcher", () => {
  let testDir: string;
  let broadcaster: { broadcast: ReturnType<typeof vi.fn> };
  let watchSpy: ReturnType<typeof vi.spyOn<typeof chokidar, "watch">>;
  let watcherEvents: Record<string, WatchEventHandler | undefined>;
  let closeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "watcher-test-"));

    broadcaster = {
      broadcast: vi.fn(),
    };

    watcherEvents = {};
    closeMock = vi.fn().mockResolvedValue(undefined);
    watchSpy = vi.spyOn(chokidar, "watch").mockReturnValue({
      on(event: string, handler: WatchEventHandler) {
        watcherEvents[event] = handler;
        return this;
      },
      close: closeMock,
    } as unknown as FSWatcher);
  });

  afterEach(async () => {
    vi.useRealTimers();
    watchSpy.mockRestore();
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create watcher with correct parameters", () => {
    const watcher = new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);
    expect(watcher).toBeDefined();
    expect(watcher).toBeInstanceOf(WorkspaceWatcher);
  });

  it("should close watcher gracefully", async () => {
    const watcher = new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);
    await expect(watcher.close()).resolves.toBeUndefined();
  });

  it("should have broadcaster reference", () => {
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);
    expect(broadcaster.broadcast).toBeDefined();
  });

  it("does not throw when broadcaster is missing", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher(
      "test-workspace-id",
      testDir,
      undefined as unknown as Parameters<typeof WorkspaceWatcher>[2]
    );

    watcherEvents.all?.();
    await vi.advanceTimersByTimeAsync(200);
  });

  it("watches git metadata but ignores node_modules, .DS_Store, Thumbs.db, .playwright-mcp when no .gitignore", () => {
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    expect(watchSpy).toHaveBeenCalledTimes(1);
    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(typeof ignored).toBe("function");
    expect(ignored?.(join(testDir, ".git/config"))).toBe(false);
    expect(ignored?.(join(testDir, "node_modules/package"))).toBe(true);
    expect(ignored?.(join(testDir, ".DS_Store"))).toBe(true);
    expect(ignored?.(join(testDir, "Thumbs.db"))).toBe(true);
    expect(ignored?.(join(testDir, "src/index.ts"))).toBe(false);
  });

  it("ignores managed target files used for agent instruction publishing", () => {
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(typeof ignored).toBe("function");
    expect(ignored?.(join(testDir, "AGENTS.md"))).toBe(true);
    expect(ignored?.(join(testDir, "GEMINI.md"))).toBe(true);
    expect(ignored?.(join(testDir, ".claude", "CLAUDE.md"))).toBe(true);
    expect(ignored?.(join(testDir, ".coder-studio", "agent.md"))).toBe(false);
  });

  it("ignores transient git lock files and write-heavy git internals", () => {
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(typeof ignored).toBe("function");
    expect(ignored?.(join(testDir, ".git", "index.lock"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "refs", "heads", "main.lock"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "objects", "pack", "pack-abc.pack"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "lfs", "objects", "ab", "cd"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "logs", "HEAD"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "hooks", "post-commit"))).toBe(true);
    expect(ignored?.(join(testDir, ".git", "info", "exclude"))).toBe(true);
  });

  it("still watches branch and worktree metadata that the UI relies on", () => {
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(typeof ignored).toBe("function");
    expect(ignored?.(join(testDir, ".git", "HEAD"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "refs", "heads", "main"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "packed-refs"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "worktrees", "feature", "HEAD"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "index"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "config"))).toBe(false);
  });

  it("swallows transient EPERM errors emitted by chokidar without bubbling up", () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster, logger);

    expect(typeof watcherEvents.error).toBe("function");

    const eperm: NodeJS.ErrnoException = Object.assign(
      new Error("EPERM: operation not permitted"),
      { code: "EPERM", path: join(testDir, ".git", "index.lock") }
    );
    expect(() => (watcherEvents.error as unknown as (err: unknown) => void)?.(eperm)).not.toThrow();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "test-workspace-id",
        code: "EPERM",
        path: join(testDir, ".git", "index.lock"),
      }),
      expect.stringMatching(/transient/i)
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs unknown watcher errors at warn level", () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster, logger);

    const unknownErr: NodeJS.ErrnoException = Object.assign(
      new Error("EMFILE: too many open files"),
      { code: "EMFILE", path: testDir }
    );
    (watcherEvents.error as unknown as (err: unknown) => void)?.(unknownErr);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "test-workspace-id",
        code: "EMFILE",
      }),
      expect.stringMatching(/emitted an error/i)
    );
  });

  it("does not let .gitignore shrink watcher coverage", async () => {
    await writeFile(join(testDir, ".gitignore"), "dist/\n*.log\n");

    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    expect(watchSpy).toHaveBeenCalledTimes(1);
    const options = watchSpy.mock.calls[0]?.[1];
    const ignored = options?.ignored;

    expect(typeof ignored).toBe("function");
    expect(ignored?.(join(testDir, "dist", "bundle.js"))).toBe(false);
    expect(ignored?.(join(testDir, "debug.log"))).toBe(false);
    expect(ignored?.(join(testDir, ".git", "index"))).toBe(false);
    expect(ignored?.(join(testDir, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(ignored?.(join(testDir, "src", "index.ts"))).toBe(false);
  });

  it("broadcasts fs.dirty after git metadata events settle", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    watcherEvents.all?.("change", join(testDir, ".git/index"));
    await vi.advanceTimersByTimeAsync(199);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.workspaceFsDirty("test-workspace-id"),
      { reason: "git_metadata" }
    );
  });

  it("upgrades mixed git metadata and file events to fs_change", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    watcherEvents.all?.("change", join(testDir, ".git/index"));
    await vi.advanceTimersByTimeAsync(100);
    watcherEvents.all?.("change", join(testDir, "src/index.ts"));

    await vi.advanceTimersByTimeAsync(199);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.workspaceFsDirty("test-workspace-id"),
      { reason: "fs_change" }
    );
  });

  it("broadcasts fs.dirty after a single file event settles", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    watcherEvents.all?.();
    await vi.advanceTimersByTimeAsync(199);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.workspaceFsDirty("test-workspace-id"),
      { reason: "fs_change" }
    );
  });

  it("invokes the dirty callback after a single file event settles", async () => {
    vi.useFakeTimers();
    const onDirty = vi.fn();

    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster, undefined, onDirty);

    watcherEvents.all?.("change", join(testDir, ".coder-studio", "agent.md"));
    await vi.advanceTimersByTimeAsync(199);
    expect(onDirty).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onDirty).toHaveBeenCalledWith("test-workspace-id", "fs_change");
  });

  it("broadcasts fs.dirty after consecutive file events settle", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    watcherEvents.all?.();
    await vi.advanceTimersByTimeAsync(100);
    watcherEvents.all?.();

    await vi.advanceTimersByTimeAsync(199);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.workspaceFsDirty("test-workspace-id"),
      { reason: "fs_change" }
    );
  });

  it("forces fs.dirty within max wait during continuous file events", async () => {
    vi.useFakeTimers();
    new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

    watcherEvents.all?.();
    for (let i = 0; i < 9; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
      watcherEvents.all?.();
      expect(broadcaster.broadcast).not.toHaveBeenCalled();
    }

    await vi.advanceTimersByTimeAsync(100);
    watcherEvents.all?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.workspaceFsDirty("test-workspace-id"),
      { reason: "fs_change" }
    );
  });
});
