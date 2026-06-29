import { EventEmitter } from "node:events";
import { createDefaultShellUpdateState, type ShellUpdateState } from "./shell-update-types.js";

export interface ShellUpdateServiceUpdater {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

interface ShellUpdateServiceDeps {
  appVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  updater: ShellUpdateServiceUpdater;
  now?: () => number;
}

export class ShellUpdateService extends EventEmitter {
  private state: ShellUpdateState;

  constructor(private readonly deps: ShellUpdateServiceDeps) {
    super();
    this.state = createDefaultShellUpdateState({
      currentVersion: deps.appVersion,
      supported: deps.isPackaged && (deps.platform === "win32" || deps.platform === "darwin"),
    });

    if (this.state.supported) {
      this.bindUpdaterEvents();
    }
  }

  getState(): ShellUpdateState {
    return { ...this.state };
  }

  async checkForUpdates(): Promise<ShellUpdateState> {
    if (!this.state.supported) {
      return this.getState();
    }

    this.patch({
      status: "checking",
      errorSummary: null,
    });

    try {
      await this.deps.updater.checkForUpdates();
    } catch (error) {
      this.patch({
        availability: "error",
        status: "failed",
        lastCheckedAt: (this.deps.now ?? Date.now)(),
        errorSummary: error instanceof Error ? error.message : String(error),
      });
    }
    return this.getState();
  }

  async downloadUpdate(): Promise<ShellUpdateState> {
    if (!this.state.supported) {
      return this.getState();
    }

    this.patch({
      status: "downloading",
      errorSummary: null,
    });

    try {
      await this.deps.updater.downloadUpdate();
    } catch (error) {
      this.patch({
        availability: "error",
        status: "failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
    }
    return this.getState();
  }

  async quitAndInstall(): Promise<void> {
    if (!this.state.supported) {
      return;
    }

    this.patch({
      status: "installing",
    });
    this.deps.updater.quitAndInstall(false, true);
  }

  private bindUpdaterEvents(): void {
    const now = this.deps.now ?? Date.now;

    this.deps.updater.on("checking-for-update", () => {
      this.patch({
        status: "checking",
        errorSummary: null,
      });
    });

    this.deps.updater.on("update-available", (info: unknown) => {
      const next = (typeof info === "object" && info !== null ? info : {}) as {
        version?: unknown;
        releaseNotes?: unknown;
      };
      this.patch({
        latestVersion: typeof next.version === "string" ? next.version : this.state.latestVersion,
        availability: "update_available",
        status: "idle",
        lastCheckedAt: now(),
        errorSummary: null,
        releaseNotes: typeof next.releaseNotes === "string" ? next.releaseNotes : null,
      });
    });

    this.deps.updater.on("update-not-available", (info: unknown) => {
      const next = (typeof info === "object" && info !== null ? info : {}) as {
        version?: unknown;
      };
      this.patch({
        latestVersion: typeof next.version === "string" ? next.version : this.state.currentVersion,
        availability: "up_to_date",
        status: "idle",
        lastCheckedAt: now(),
        errorSummary: null,
      });
    });

    this.deps.updater.on("update-downloaded", (info: unknown) => {
      const next = (typeof info === "object" && info !== null ? info : {}) as {
        version?: unknown;
      };
      this.patch({
        latestVersion: typeof next.version === "string" ? next.version : this.state.latestVersion,
        availability: "downloaded",
        status: "ready_to_restart",
        errorSummary: null,
      });
    });

    this.deps.updater.on("error", (error: unknown) => {
      this.patch({
        availability: "error",
        status: "failed",
        lastCheckedAt: now(),
        errorSummary: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private patch(patch: Partial<ShellUpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.emit("state-changed", this.getState());
  }
}
