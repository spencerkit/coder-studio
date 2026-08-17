import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DesktopShellUpdateAdapter, type ShellUpdaterPort } from "./update-manager.js";

function createUpdater() {
  const emitter = new EventEmitter();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    channel: null,
    disableDifferentialDownload: false,
    disableWebInstaller: false,
    on: (event: string, listener: (value: unknown) => void) => {
      emitter.on(event, listener);
      return updater;
    },
    emit: (event: string, value: unknown) => emitter.emit(event, value),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: "0.3.0" } })),
    downloadUpdate: vi.fn(async () => ["installer.exe"]),
    quitAndInstall: vi.fn(),
  };
  return updater as unknown as typeof updater & ShellUpdaterPort;
}

const expectedShell = {
  version: "0.3.0",
  publishedAt: "2026-08-08T01:02:03.000Z",
  updaterMetadata: "latest.yml" as const,
  engineVersion: "2",
  nodeVersion: "24.19.0",
  runtimeHostApiVersion: 1,
  apiProtocolVersion: 1,
  dataSchemaVersion: 1,
};

describe("DesktopShellUpdateAdapter", () => {
  it("pins updater metadata to the signed Desktop channel without auto-downloading", async () => {
    const updater = createUpdater();
    const adapter = new DesktopShellUpdateAdapter({
      updater,
      currentVersion: "0.2.0",
      isPackaged: true,
      updaterChannel: "modern",
    });
    adapter.start();

    await expect(adapter.checkMetadata(expectedShell)).resolves.toEqual({
      componentId: "shell",
      version: "0.3.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      updateNeeded: true,
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.disableWebInstaller).toBe(true);
    expect(updater.channel).toBe("modern");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("allows GitHub prerelease discovery only when the caller explicitly enables acceptance", () => {
    const updater = createUpdater();
    const adapter = new DesktopShellUpdateAdapter({
      updater,
      currentVersion: "0.2.0",
      isPackaged: true,
      allowPrerelease: true,
    });

    adapter.start();

    expect(updater.allowPrerelease).toBe(true);
  });

  it("rejects updater source drift and carries an already installed Shell", async () => {
    const updater = createUpdater();
    updater.checkForUpdates.mockResolvedValueOnce({ updateInfo: { version: "0.4.0" } });
    const adapter = new DesktopShellUpdateAdapter({
      updater,
      currentVersion: "0.2.0",
      isPackaged: true,
    });
    await expect(adapter.checkMetadata(expectedShell)).rejects.toThrow(
      "does not match signed Desktop channel"
    );

    const carriedUpdater = createUpdater();
    const carried = new DesktopShellUpdateAdapter({
      updater: carriedUpdater,
      currentVersion: "0.3.0",
      isPackaged: true,
    });
    await expect(carried.checkMetadata(expectedShell)).resolves.toMatchObject({
      version: "0.3.0",
      updateNeeded: false,
    });
    expect(carriedUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("reports progress, cancels only an active download, and installs once", async () => {
    const updater = createUpdater();
    const token = { cancel: vi.fn() };
    const adapter = new DesktopShellUpdateAdapter({
      updater,
      currentVersion: "0.2.0",
      isPackaged: true,
      createCancellationToken: () => token,
      logLocations: ["updates.log"],
      manualInstallerUrl: "https://releases.example/desktop",
    });
    const metadata = await adapter.checkMetadata(expectedShell);
    const onProgress = vi.fn();
    const download = adapter.download(metadata, onProgress);
    updater.emit("download-progress", { percent: 45 });
    expect(onProgress).toHaveBeenCalledWith(45);
    expect(adapter.cancelDownload()).toBe(true);
    await expect(download).rejects.toMatchObject({ name: "CancellationError" });
    expect(token.cancel).toHaveBeenCalledTimes(1);
    expect(adapter.cancelDownload()).toBe(false);

    const second = adapter.download(metadata, onProgress);
    updater.emit("update-downloaded", { version: "0.3.0" });
    await expect(second).resolves.toBeUndefined();
    expect(updater.autoInstallOnAppQuit).toBe(false);
    adapter.armInstallOnQuit();
    adapter.quitAndInstall();
    adapter.quitAndInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(adapter.getDiagnostics()).toEqual({
      logLocations: ["updates.log"],
      recoveryAction: "https://releases.example/desktop",
    });
  });

  it("cancels a Shell download that stops reporting progress", async () => {
    vi.useFakeTimers();
    try {
      const updater = createUpdater();
      const token = { cancel: vi.fn() };
      const adapter = new DesktopShellUpdateAdapter({
        updater,
        currentVersion: "0.2.0",
        isPackaged: true,
        createCancellationToken: () => token,
        downloadInactivityTimeoutMs: 1_000,
      });
      const metadata = await adapter.checkMetadata(expectedShell);
      const download = adapter.download(metadata, vi.fn());
      const rejected = expect(download).rejects.toMatchObject({ name: "TimeoutError" });

      await vi.advanceTimersByTimeAsync(900);
      updater.emit("download-progress", { percent: 1 });
      await vi.advanceTimersByTimeAsync(900);
      expect(token.cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(token.cancel).toHaveBeenCalledTimes(1);
      expect(adapter.cancelDownload()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
