import type { BrowserWindow, MessageBoxOptions } from "electron";
import { dialog } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";

interface DesktopUpdateManagerOptions {
  currentVersion: string;
  getWindow(): BrowserWindow | null;
  isPackaged: boolean;
}

const AUTO_CHECK_DELAY_MS = 15_000;

export class DesktopUpdateManager {
  private autoCheckTimer: NodeJS.Timeout | null = null;
  private checking = false;
  private downloading = false;
  private manualCheck = false;

  constructor(private readonly options: DesktopUpdateManagerOptions) {}

  start(): void {
    if (!this.options.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = this.options.currentVersion.includes("-");
    autoUpdater.on("update-available", (info) => void this.onUpdateAvailable(info));
    autoUpdater.on("update-not-available", () => void this.onUpdateNotAvailable());
    autoUpdater.on("download-progress", (progress) => this.onDownloadProgress(progress));
    autoUpdater.on("update-downloaded", (info) => void this.onUpdateDownloaded(info));
    autoUpdater.on("error", (updateError) => void this.onError(updateError));

    this.autoCheckTimer = setTimeout(() => {
      void this.check(false);
    }, AUTO_CHECK_DELAY_MS);
    this.autoCheckTimer.unref?.();
  }

  stop(): void {
    if (this.autoCheckTimer) clearTimeout(this.autoCheckTimer);
    this.autoCheckTimer = null;
    this.options.getWindow()?.setProgressBar(-1);
  }

  async check(manual = true): Promise<void> {
    if (!this.options.isPackaged) {
      if (manual) {
        await this.showMessage({
          type: "info",
          title: "Desktop updates",
          message: "Update checks are available in packaged desktop builds.",
          buttons: ["OK"],
        });
      }
      return;
    }
    if (this.checking || this.downloading) {
      if (manual) {
        await this.showMessage({
          type: "info",
          title: "Desktop updates",
          message: this.downloading
            ? "Coder Studio is downloading an update."
            : "Coder Studio is already checking for updates.",
          buttons: ["OK"],
        });
      }
      return;
    }

    this.checking = true;
    this.manualCheck = manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (checkError) {
      if (this.checking) await this.onError(checkError);
    }
  }

  private async onUpdateAvailable(info: UpdateInfo): Promise<void> {
    this.checking = false;
    const result = await this.showMessage({
      type: "info",
      title: "Coder Studio update available",
      message: `Coder Studio ${info.version} is available.`,
      detail: "Download it now? You can keep working while the package downloads.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    this.manualCheck = false;
    if (result.response !== 0) return;

    this.downloading = true;
    this.options.getWindow()?.setProgressBar(0.01);
    try {
      await autoUpdater.downloadUpdate();
    } catch (downloadError) {
      if (this.downloading) await this.onError(downloadError);
    }
  }

  private async onUpdateNotAvailable(): Promise<void> {
    this.checking = false;
    if (this.manualCheck) {
      await this.showMessage({
        type: "info",
        title: "Coder Studio is up to date",
        message: `You are running the latest version (${this.options.currentVersion}).`,
        buttons: ["OK"],
      });
    }
    this.manualCheck = false;
  }

  private onDownloadProgress(progress: ProgressInfo): void {
    this.options.getWindow()?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
  }

  private async onUpdateDownloaded(info: UpdateInfo): Promise<void> {
    this.downloading = false;
    this.options.getWindow()?.setProgressBar(-1);
    const result = await this.showMessage({
      type: "info",
      title: "Coder Studio update ready",
      message: `Coder Studio ${info.version} has been downloaded.`,
      detail: "Restart now to install it. Active terminals and agent sessions will be stopped.",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  }

  private async onError(updateError: unknown): Promise<void> {
    const shouldReport = this.manualCheck || this.downloading;
    this.checking = false;
    this.downloading = false;
    this.manualCheck = false;
    this.options.getWindow()?.setProgressBar(-1);
    if (!shouldReport) return;

    await this.showMessage({
      type: "error",
      title: "Unable to update Coder Studio",
      message: "The desktop update could not be completed.",
      detail: updateError instanceof Error ? updateError.message : String(updateError),
      buttons: ["OK"],
    });
  }

  private showMessage(options: MessageBoxOptions) {
    const window = this.options.getWindow();
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  }
}
