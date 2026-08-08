import { EventEmitter } from "node:events";
import type { DesktopChannel } from "./desktop-channel.js";
import { compareVersions } from "./runtime-manifest.js";

export interface ShellCancellationToken {
  cancel(): void;
}

export interface ShellUpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: "download-progress", listener: (value: { percent?: number }) => void): unknown;
  on(event: "update-downloaded", listener: (value: { version?: string }) => void): unknown;
  on(event: "error", listener: (value: unknown) => void): unknown;
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
  createCancellationToken?: () => ShellCancellationToken;
  logLocations?: string[];
  manualInstallerUrl?: string | null;
}

interface ActiveDownload {
  expectedVersion: string;
  token: ShellCancellationToken;
  onProgress: (percent: number) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

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
    this.options.updater.allowPrerelease =
      this.options.allowPrerelease === true || this.options.currentVersion.includes("-");
    this.options.updater.on("download-progress", (progress: { percent?: number }) => {
      if (!this.activeDownload || typeof progress.percent !== "number") return;
      this.activeDownload.onProgress(Math.max(0, Math.min(100, progress.percent)));
    });
    this.options.updater.on("update-downloaded", (info: { version?: string }) => {
      const active = this.activeDownload;
      if (!active) return;
      this.activeDownload = null;
      if (info.version !== active.expectedVersion) {
        active.reject(new Error("Downloaded Desktop Shell does not match signed Desktop channel"));
        return;
      }
      active.resolve();
    });
    this.options.updater.on("error", (error: unknown) => {
      const active = this.activeDownload;
      if (!active) return;
      this.activeDownload = null;
      active.reject(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async checkMetadata(expected: DesktopChannel["shell"]): Promise<ShellUpdateMetadata> {
    this.start();
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
      };
      void this.options.updater.downloadUpdate(token).catch((error: unknown) => {
        const active = this.activeDownload;
        if (!active || active.token !== token) return;
        this.activeDownload = null;
        active.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  cancelDownload(): boolean {
    const active = this.activeDownload;
    if (!active) return false;
    this.activeDownload = null;
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
