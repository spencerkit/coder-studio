import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ShellUpdateService, type ShellUpdateServiceUpdater } from "./shell-update-service.js";
import { createDefaultShellUpdateState } from "./shell-update-types.js";

class MockUpdater extends EventEmitter implements ShellUpdateServiceUpdater {
  readonly checkForUpdates = vi.fn(async () => {
    return null;
  });

  readonly downloadUpdate = vi.fn(async () => {
    return null;
  });

  readonly quitAndInstall = vi.fn(() => {});

  emitChecking(): void {
    this.emit("checking-for-update");
  }

  emitAvailable(input: { version: string; releaseNotes?: string | null }): void {
    this.emit("update-available", input);
  }

  emitNotAvailable(input: { version?: string }): void {
    this.emit("update-not-available", input);
  }

  emitDownloaded(input: { version: string }): void {
    this.emit("update-downloaded", input);
  }

  emitError(error: unknown): void {
    this.emit("error", error);
  }
}

describe("shell update types", () => {
  it("creates an unsupported default state", () => {
    expect(createDefaultShellUpdateState({ currentVersion: "1.2.3", supported: false })).toEqual({
      supported: false,
      currentVersion: "1.2.3",
      latestVersion: null,
      availability: "unknown",
      status: "idle",
      lastCheckedAt: null,
      errorSummary: null,
      releaseNotes: null,
    });
  });
});

describe("ShellUpdateService", () => {
  it("reports unsupported when the app is unpackaged", () => {
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: false,
      platform: "win32",
      updater: new MockUpdater(),
    });

    expect(service.getState()).toEqual({
      supported: false,
      currentVersion: "1.2.3",
      latestVersion: null,
      availability: "unknown",
      status: "idle",
      lastCheckedAt: null,
      errorSummary: null,
      releaseNotes: null,
    });
  });

  it("reports unsupported on linux in phase 1", () => {
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "linux",
      updater: new MockUpdater(),
    });

    expect(service.getState().supported).toBe(false);
  });

  it("marks update_available after a newer shell version is reported", async () => {
    const updater = new MockUpdater();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emitChecking();
      updater.emitAvailable({
        version: "1.2.4",
        releaseNotes: "Bug fixes",
      });
      return null;
    });
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "win32",
      updater,
      now: () => 123,
    });

    const state = await service.checkForUpdates();

    expect(state).toMatchObject({
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      availability: "update_available",
      status: "idle",
      lastCheckedAt: 123,
      errorSummary: null,
      releaseNotes: "Bug fixes",
    });
  });

  it("marks failed when checkForUpdates rejects", async () => {
    const updater = new MockUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("network down"));
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "win32",
      updater,
      now: () => 789,
    });

    const state = await service.checkForUpdates();

    expect(state).toMatchObject({
      availability: "error",
      status: "failed",
      lastCheckedAt: 789,
      errorSummary: "network down",
    });
  });

  it("marks up_to_date when no newer shell version is available", async () => {
    const updater = new MockUpdater();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emitNotAvailable({ version: "1.2.3" });
      return null;
    });
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "darwin",
      updater,
      now: () => 222,
    });

    const state = await service.checkForUpdates();

    expect(state).toMatchObject({
      latestVersion: "1.2.3",
      availability: "up_to_date",
      status: "idle",
      lastCheckedAt: 222,
    });
  });

  it("marks ready_to_restart after download completes", async () => {
    const updater = new MockUpdater();
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emitDownloaded({ version: "1.2.4" });
      return null;
    });
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "darwin",
      updater,
    });

    const state = await service.downloadUpdate();

    expect(state).toMatchObject({
      latestVersion: "1.2.4",
      availability: "downloaded",
      status: "ready_to_restart",
      errorSummary: null,
    });
  });

  it("marks failed when downloadUpdate rejects", async () => {
    const updater = new MockUpdater();
    updater.downloadUpdate.mockRejectedValueOnce(new Error("download failed"));
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "darwin",
      updater,
    });

    const state = await service.downloadUpdate();

    expect(state).toMatchObject({
      availability: "error",
      status: "failed",
      errorSummary: "download failed",
    });
  });

  it("transitions to installing when quitAndInstall is requested", async () => {
    const updater = new MockUpdater();
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "win32",
      updater,
    });

    await service.quitAndInstall();

    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(service.getState().status).toBe("installing");
  });

  it("marks failed when the updater emits an error", async () => {
    const updater = new MockUpdater();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emitError(new Error("network down"));
      return null;
    });
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "win32",
      updater,
      now: () => 456,
    });

    const state = await service.checkForUpdates();

    expect(state).toMatchObject({
      availability: "error",
      status: "failed",
      lastCheckedAt: 456,
      errorSummary: "network down",
    });
  });

  it("emits state-changed notifications for renderer subscribers", async () => {
    const updater = new MockUpdater();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emitAvailable({ version: "1.2.4" });
      return null;
    });
    const service = new ShellUpdateService({
      appVersion: "1.2.3",
      isPackaged: true,
      platform: "win32",
      updater,
    });
    const listener = vi.fn();

    service.on("state-changed", listener);

    await service.checkForUpdates();

    expect(listener).toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        latestVersion: "1.2.4",
        availability: "update_available",
      })
    );
  });

  it("exposes the preload shellUpdate api shape", async () => {
    const listeners = new Map<string, (state: unknown) => void>();
    const send = vi.fn();
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "desktop:shell-update:get-state") {
        return {
          supported: true,
          currentVersion: "1.2.3",
          latestVersion: null,
          availability: "unknown",
          status: "idle",
          lastCheckedAt: null,
          errorSummary: null,
          releaseNotes: null,
        };
      }
      return null;
    });
    const on = vi.fn((channel: string, listener: (_event: unknown, state: unknown) => void) => {
      listeners.set(channel, (state: unknown) => listener({}, state));
    });
    const removeListener = vi.fn();
    const exposed: { coderStudioDesktop?: Record<string, unknown> } = {};

    const exposeInMainWorld = vi.fn((key: string, value: unknown) => {
      exposed[key as "coderStudioDesktop"] = value as Record<string, unknown>;
    });

    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        send,
        invoke,
        on,
        removeListener,
      },
    }));

    vi.resetModules();
    await import("./preload.js");

    const bridge = exposed.coderStudioDesktop as {
      shellUpdate: {
        getState(): Promise<unknown>;
        check(): Promise<unknown>;
        install(): Promise<unknown>;
        restartToApply(): Promise<unknown>;
        subscribe(listener: (state: unknown) => void): () => void;
      };
    };

    expect(bridge.shellUpdate).toBeDefined();
    expect(await bridge.shellUpdate.getState()).toMatchObject({
      currentVersion: "1.2.3",
    });

    const listener = vi.fn();
    const unsubscribe = bridge.shellUpdate.subscribe(listener);
    listeners.get("desktop:shell-update:state-changed")?.({
      latestVersion: "1.2.4",
    });

    expect(listener).toHaveBeenCalledWith({
      latestVersion: "1.2.4",
    });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(
      "desktop:shell-update:state-changed",
      expect.any(Function)
    );

    vi.doUnmock("electron");
  });
});
