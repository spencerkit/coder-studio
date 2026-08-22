import { EventEmitter } from "node:events";
import type { DesktopChannel } from "./desktop-channel.js";
import { resolveVersionedReleaseAsset } from "./release-channel.js";
import { compareVersions } from "./runtime-manifest.js";

export interface ShellCancellationToken {
  cancel(): void;
}

export interface ShellUpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  disableDifferentialDownload: boolean;
  disableWebInstaller: boolean;
  on(event: "download-progress", listener: (value: { percent?: number }) => void): unknown;
  on(event: "update-downloaded", listener: (value: { version?: string }) => void): unknown;
  on(event: "error", listener: (value: unknown) => void): unknown;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(token?: ShellCancellationToken): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface ShellUpdateMetadata {
  componentId: "shell";
  version: string;
  publishedAt: string;
  updateNeeded: boolean;
}

export interface ShellUpdateDiagnostics {
  logLocations: string[];
  recoveryAction: string | null;
}

export interface DesktopShellUpdateAdapterOptions {
  updater: ShellUpdaterPort;
  currentVersion: string;
  isPackaged: boolean;
  allowPrerelease?: boolean;
  updaterChannel?: string;
  desktopChannelUrl?: string;
  createCancellationToken?: () => ShellCancellationToken;
  logLocations?: string[];
  manualInstallerUrl?: string | null;
  downloadInactivityTimeoutMs?: number;
}

interface ActiveDownload {
  expectedVersion: string;
  token: ShellCancellationToken;
  onProgress: (percent: number) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1_000;

class LocalCancellationToken extends EventEmitter implements ShellCancellationToken {
  cancelled = false;

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.emit("cancel");
  }

  onCancel(handler: () => void): void {
    if (this.cancelled) handler();
    else this.once("cancel", handler);
  }
}

export class ShellCancellationError extends Error {
  constructor() {
    super("Desktop Shell download was cancelled");
    this.name = "CancellationError";
  }
}

export class ShellDownloadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Desktop Shell download made no progress for ${Math.ceil(timeoutMs / 1_000)} seconds`);
    this.name = "TimeoutError";
  }
}

export class DesktopShellUpdateAdapter {
  private started = false;
  private activeDownload: ActiveDownload | null = null;
  private installInvoked = false;

  constructor(private readonly options: DesktopShellUpdateAdapterOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.updater.autoDownload = false;
    this.options.updater.autoInstallOnAppQuit = false;
    this.options.updater.disableDifferentialDownload = true;
    this.options.updater.disableWebInstaller = true;
    this.options.updater.channel = this.options.desktopChannelUrl
      ? null
      : (this.options.updaterChannel ?? null);
    this.options.updater.allowPrerelease =
      this.options.allowPrerelease === true || this.options.currentVersion.includes("-");
    this.options.updater.on("download-progress", (progress: { percent?: number }) => {
      if (!this.activeDownload || typeof progress.percent !== "number") return;
      this.resetDownloadInactivityTimer(this.activeDownload);
      this.activeDownload.onProgress(Math.max(0, Math.min(100, progress.percent)));
    });
    this.options.updater.on("update-downloaded", (info: { version?: string }) => {
      const active = this.takeActiveDownload();
      if (!active) return;
      if (info.version !== active.expectedVersion) {
        active.reject(new Error("Downloaded Desktop Shell does not match signed Desktop channel"));
        return;
      }
      active.resolve();
    });
    this.options.updater.on("error", (error: unknown) => {
      const active = this.takeActiveDownload();
      if (!active) return;
      active.reject(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private takeActiveDownload(): ActiveDownload | null {
    const active = this.activeDownload;
    if (!active) return null;
    this.activeDownload = null;
    if (active.inactivityTimer) clearTimeout(active.inactivityTimer);
    active.inactivityTimer = null;
    return active;
  }

  private resetDownloadInactivityTimer(active: ActiveDownload): void {
    if (active.inactivityTimer) clearTimeout(active.inactivityTimer);
    const timeoutMs =
      this.options.downloadInactivityTimeoutMs ?? DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      active.inactivityTimer = null;
      return;
    }
    active.inactivityTimer = setTimeout(() => {
      if (this.activeDownload !== active) return;
      this.takeActiveDownload();
      active.token.cancel();
      active.reject(new ShellDownloadTimeoutError(timeoutMs));
    }, timeoutMs);
  }

  async checkMetadata(channel: DesktopChannel): Promise<ShellUpdateMetadata> {
    this.start();
    const expected = channel.shell;
    const versionOrder = compareVersions(expected.version, this.options.currentVersion);
    if (versionOrder < 0) {
      throw new Error("Signed Desktop channel Shell is older than the installed Shell");
    }
    if (versionOrder === 0) {
      return {
        componentId: "shell",
        version: expected.version,
        publishedAt: expected.publishedAt,
        updateNeeded: false,
      };
    }
    if (!this.options.isPackaged) {
      throw new Error("Desktop Shell updates require a packaged Desktop build");
    }
    if (!this.options.desktopChannelUrl) {
      throw new Error("No Desktop Shell update channel is configured");
    }
    if (expected.updaterMetadata !== "latest.yml") {
      throw new Error("Signed Desktop channel updater metadata is unsupported");
    }
    const metadataUrl = resolveVersionedReleaseAsset(
      this.options.desktopChannelUrl,
      channel.releaseTag,
      expected.updaterMetadata
    );
    this.options.updater.setFeedURL({
      provider: "generic",
      url: new URL(".", metadataUrl).toString(),
    });
    const result = await this.options.updater.checkForUpdates();
    if (!result || result.updateInfo.version !== expected.version) {
      throw new Error("Desktop Shell updater does not match signed Desktop channel");
    }
    return {
      componentId: "shell",
      version: expected.version,
      publishedAt: expected.publishedAt,
      updateNeeded: true,
    };
  }

  download(metadata: ShellUpdateMetadata, onProgress: (percent: number) => void): Promise<void> {
    this.start();
    if (!metadata.updateNeeded) {
      throw new Error("The Desktop Shell is already current");
    }
    if (this.activeDownload) throw new Error("A Desktop Shell download is already active");
    const token = this.options.createCancellationToken?.() ?? new LocalCancellationToken();
    return new Promise<void>((resolve, reject) => {
      this.activeDownload = {
        expectedVersion: metadata.version,
        token,
        onProgress,
        resolve,
        reject,
        inactivityTimer: null,
      };
      this.resetDownloadInactivityTimer(this.activeDownload);
      void this.options.updater.downloadUpdate(token).catch((error: unknown) => {
        const active = this.activeDownload;
        if (!active || active.token !== token) return;
        const failed = this.takeActiveDownload();
        failed?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  cancelDownload(): boolean {
    const active = this.takeActiveDownload();
    if (!active) return false;
    active.token.cancel();
    active.reject(new ShellCancellationError());
    return true;
  }

  armInstallOnQuit(): void {
    this.options.updater.autoInstallOnAppQuit = true;
  }

  disarmInstallOnQuit(): void {
    this.options.updater.autoInstallOnAppQuit = false;
  }

  getDiagnostics(): ShellUpdateDiagnostics {
    return {
      logLocations: [...(this.options.logLocations ?? [])],
      recoveryAction: this.options.manualInstallerUrl ?? null,
    };
  }

  quitAndInstall(): void {
    if (this.installInvoked) return;
    this.installInvoked = true;
    this.options.updater.quitAndInstall(false, true);
  }
}
