import { spawn } from "node:child_process";
import {
  createDefaultUpdateSettings,
  resolveUpdateAutoCheckEnabled,
  resolveUpdateCheckIntervalSec,
  type UpdateActivitySummary,
  type UpdatePrepareInstallResponse,
  type UpdateStateSnapshot,
  type UpdateStateView,
  type UpdateSupportInfo,
} from "@coder-studio/core";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { UpdateStateRepo } from "../storage/repositories/update-state-repo.js";
import type { Broadcaster } from "../ws/hub.js";

export interface UpdateRuntimeConfig {
  supported: boolean;
  installKind: "global_npm" | "desktop_managed" | "unsupported";
  packageName: string;
  currentVersion: string;
  cliCommand: string;
  workerEntryPath?: string;
  npmCommand?: string;
  restartArgs?: string[];
  installArgsPrefix?: string[];
  unsupportedReason?: string | null;
}

export interface UpdateServiceDeps {
  settingsRepo: Pick<SettingsRepo, "get">;
  updateStateRepo: UpdateStateRepo;
  broadcaster: Broadcaster;
  runtime: UpdateRuntimeConfig;
  updateWorkerLogFilePath: string;
  countRunningTerminals: () => number;
  countRunningSessions: () => number;
  countActiveSupervisors: () => number;
  runLatestVersionLookup?: (packageName: string) => Promise<string>;
  now?: () => number;
  spawnDetachedWorker?: (input: {
    workerEntryPath: string;
    stateFilePath: string;
    logFilePath: string;
    packageName: string;
    targetVersion: string;
    cliCommand: string;
    currentVersion: string;
    npmCommand: string;
    restartArgs: string[];
    installArgsPrefix: string[];
  }) => Promise<void> | void;
}

function isBusyStatus(status: UpdateStateSnapshot["updateStatus"]): boolean {
  return status === "checking" || status === "installing" || status === "restarting";
}

function createBusyError(message: string) {
  return {
    code: "update_busy",
    message,
  };
}

function createValidationError(code: string, message: string) {
  return { code, message };
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .split(".")
    .map((segment) => {
      const match = segment.match(/^(\d+)/);
      return match ? Number.parseInt(match[1]!, 10) : 0;
    });
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

export class UpdateService {
  private static readonly CHECK_TIMEOUT_MS = 15_000;
  private readonly now: () => number;
  private readonly runtime: UpdateRuntimeConfig;
  private readonly updateWorkerLogFilePath: string;
  private readonly runLatestVersionLookup: (packageName: string) => Promise<string>;
  private readonly spawnDetachedWorkerImpl: UpdateServiceDeps["spawnDetachedWorker"];
  private scheduleTimer: NodeJS.Timeout | null = null;
  private inFlightCheck: Promise<UpdateStateView> | null = null;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.runtime = deps.runtime;
    this.updateWorkerLogFilePath = deps.updateWorkerLogFilePath;
    this.runLatestVersionLookup =
      deps.runLatestVersionLookup ??
      (async (packageName) => {
        const response = await fetch(
          `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`
        );
        if (!response.ok) {
          throw new Error(`npm registry request failed with ${response.status}`);
        }
        const data = (await response.json()) as { latest?: unknown };
        if (typeof data.latest !== "string" || !data.latest.trim()) {
          throw new Error("npm registry did not return a latest version");
        }
        return data.latest.trim();
      });
    this.spawnDetachedWorkerImpl = deps.spawnDetachedWorker;
  }

  start(): void {
    this.reconcileOnStartup();
    this.reloadScheduleFromSettings();
    if (this.getSettings().autoCheckEnabled) {
      void this.checkForUpdates({ manual: false }).catch(() => {});
    }
  }

  stop(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  reloadScheduleFromSettings(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    const settings = this.getSettings();
    if (!settings.autoCheckEnabled) {
      return;
    }

    this.scheduleTimer = setInterval(() => {
      void this.checkForUpdates({ manual: false }).catch(() => {});
    }, settings.checkIntervalSec * 1000);
    this.scheduleTimer.unref?.();
  }

  getStateView(): UpdateStateView {
    const persisted = this.deps.updateStateRepo.get();
    return this.composeStateView(persisted);
  }

  getPrepareInstallState(): UpdatePrepareInstallResponse {
    const state = this.getStateView();
    const activity = this.summarizeActivity();
    const canStartInstall =
      state.supported &&
      state.availability === "update_available" &&
      Boolean(state.latestVersion) &&
      !isBusyStatus(state.updateStatus);

    return {
      ...state,
      activity,
      canStartInstall,
    };
  }

  async checkForUpdates(_options: { manual: boolean }): Promise<UpdateStateView> {
    const current = this.deps.updateStateRepo.get();
    if (current.updateStatus === "installing" || current.updateStatus === "restarting") {
      throw createBusyError("Update installation is already in progress");
    }
    if (this.inFlightCheck) {
      throw createBusyError("Update check is already in progress");
    }

    this.inFlightCheck = this.runCheckForUpdates();
    this.broadcastStateChange();

    try {
      return await this.inFlightCheck;
    } finally {
      this.inFlightCheck = null;
    }
  }

  prepareInstall(): UpdatePrepareInstallResponse {
    return this.getPrepareInstallState();
  }

  async startInstall(input: {
    targetVersion?: string | null;
    force?: boolean;
  }): Promise<UpdateStateView> {
    const state = this.deps.updateStateRepo.get();
    const support = this.getSupportInfo();
    if (!support.supported) {
      throw createValidationError("update_unsupported", support.unsupportedReason ?? "Unsupported");
    }
    if (state.updateStatus === "installing" || state.updateStatus === "restarting") {
      throw createBusyError("Update installation is already in progress");
    }
    if (this.inFlightCheck) {
      throw createBusyError("Update check is already in progress");
    }
    const targetVersion = input.targetVersion ?? state.latestVersion;
    if (!targetVersion) {
      throw createValidationError("update_no_target", "No target version is available");
    }
    if (targetVersion === this.runtime.currentVersion) {
      throw createValidationError("update_no_target", "Already on the requested version");
    }
    const activity = this.summarizeActivity();
    if (activity.hasActiveWork && !input.force) {
      throw createValidationError(
        "update_active_work_confirmation_required",
        "Active work must be confirmed before updating"
      );
    }
    if (this.runtime.installKind === "desktop_managed") {
      return this.persistAndBroadcast({
        latestVersion: targetVersion,
        targetVersion,
        updateStatus: "installing",
        startedAt: this.now(),
        finishedAt: null,
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      });
    }
    if (!this.runtime.workerEntryPath) {
      const manualState = this.persistAndBroadcast({
        latestVersion: targetVersion,
        targetVersion,
        updateStatus: "manual_required",
        startedAt: this.now(),
        finishedAt: this.now(),
        requiresManualStep: true,
        manualCommand: this.buildManualCommand(targetVersion),
        errorSummary: "Automatic update worker is unavailable in this runtime",
      });
      return manualState;
    }

    const installingState = this.persistAndBroadcast({
      latestVersion: targetVersion,
      targetVersion,
      updateStatus: "installing",
      startedAt: this.now(),
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });

    try {
      await this.spawnDetachedWorker({
        workerEntryPath: this.runtime.workerEntryPath,
        stateFilePath: this.deps.updateStateRepo.getFilePath(),
        logFilePath: this.updateWorkerLogFilePath,
        packageName: this.runtime.packageName,
        targetVersion,
        cliCommand: this.runtime.cliCommand,
        currentVersion: this.runtime.currentVersion,
        npmCommand: this.runtime.npmCommand ?? "npm",
        restartArgs: this.runtime.restartArgs ?? ["serve", "--restart"],
        installArgsPrefix: this.runtime.installArgsPrefix ?? ["install", "-g"],
      });
      return installingState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.persistAndBroadcast({
        updateStatus: "failed",
        finishedAt: this.now(),
        errorSummary: message,
      });
    }
  }

  reconcileOnStartup(): UpdateStateView {
    const current = this.deps.updateStateRepo.get();
    if (current.targetVersion && current.targetVersion === this.runtime.currentVersion) {
      return this.persistAndBroadcast({
        currentVersion: this.runtime.currentVersion,
        latestVersion: this.runtime.currentVersion,
        availability: "up_to_date",
        updateStatus: "succeeded",
        finishedAt: this.now(),
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      });
    }
    if (current.updateStatus === "checking") {
      return this.persistAndBroadcast({
        currentVersion: this.runtime.currentVersion,
        availability: "check_failed",
        updateStatus: "failed",
        finishedAt: this.now(),
        errorSummary: "Update check did not complete before the service restarted",
      });
    }
    if (current.updateStatus === "installing" || current.updateStatus === "restarting") {
      return this.persistAndBroadcast({
        currentVersion: this.runtime.currentVersion,
        updateStatus: "failed",
        finishedAt: this.now(),
        errorSummary: "Update did not complete before the service restarted",
      });
    }
    if (current.currentVersion !== this.runtime.currentVersion) {
      return this.persistAndBroadcast({
        currentVersion: this.runtime.currentVersion,
      });
    }
    return this.getStateView();
  }

  private getSettings(): ReturnType<typeof createDefaultUpdateSettings> {
    return {
      autoCheckEnabled: resolveUpdateAutoCheckEnabled(
        this.deps.settingsRepo.get("updates.autoCheckEnabled")
      ),
      checkIntervalSec: resolveUpdateCheckIntervalSec(
        this.deps.settingsRepo.get("updates.checkIntervalSec")
      ),
    };
  }

  private getSupportInfo(): UpdateSupportInfo {
    if (!this.runtime.supported) {
      return {
        supported: false,
        installKind: "unsupported",
        unsupportedReason:
          this.runtime.unsupportedReason ?? "Current install does not support in-app updates",
      };
    }
    return {
      supported: true,
      installKind: this.runtime.installKind,
      unsupportedReason: null,
    };
  }

  private summarizeActivity(): UpdateActivitySummary {
    const runningTerminalCount = this.deps.countRunningTerminals();
    const runningSessionCount = this.deps.countRunningSessions();
    const runningSupervisorCount = this.deps.countActiveSupervisors();
    return {
      runningTerminalCount,
      runningSessionCount,
      runningSupervisorCount,
      hasActiveWork:
        runningTerminalCount > 0 || runningSessionCount > 0 || runningSupervisorCount > 0,
    };
  }

  private buildManualCommand(targetVersion: string): string {
    return [
      `${this.runtime.npmCommand ?? "npm"} install -g ${this.runtime.packageName}@${targetVersion}`,
      `${this.runtime.cliCommand} ${(this.runtime.restartArgs ?? ["serve", "--restart"]).join(" ")}`,
    ].join("\n");
  }

  private async spawnDetachedWorker(
    input: Parameters<NonNullable<UpdateServiceDeps["spawnDetachedWorker"]>>[0]
  ): Promise<void> {
    if (this.spawnDetachedWorkerImpl) {
      await this.spawnDetachedWorkerImpl(input);
      return;
    }

    const child = spawn(process.execPath, [input.workerEntryPath], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CODER_STUDIO_UPDATE_STATE_PATH: input.stateFilePath,
        CODER_STUDIO_UPDATE_LOG_PATH: input.logFilePath,
        CODER_STUDIO_UPDATE_PACKAGE_NAME: input.packageName,
        CODER_STUDIO_UPDATE_TARGET_VERSION: input.targetVersion,
        CODER_STUDIO_UPDATE_CLI_COMMAND: input.cliCommand,
        CODER_STUDIO_UPDATE_NPM_COMMAND: input.npmCommand,
        CODER_STUDIO_UPDATE_CURRENT_VERSION: input.currentVersion,
        CODER_STUDIO_UPDATE_RESTART_ARGS: JSON.stringify(input.restartArgs),
        CODER_STUDIO_UPDATE_INSTALL_ARGS_PREFIX: JSON.stringify(input.installArgsPrefix),
      },
    });
    child.unref();
  }

  private composeStateView(
    snapshot: UpdateStateSnapshot,
    options?: { includeInFlightCheck?: boolean }
  ): UpdateStateView {
    if (options?.includeInFlightCheck !== false && this.inFlightCheck) {
      return {
        ...snapshot,
        ...this.getSupportInfo(),
        updateStatus: "checking",
        errorSummary: null,
      };
    }
    return {
      ...snapshot,
      ...this.getSupportInfo(),
    };
  }

  private broadcastStateChange(): void {
    this.deps.broadcaster.broadcast("update.state.changed", this.getStateView());
  }

  private async runCheckForUpdates(): Promise<UpdateStateView> {
    try {
      const latestVersion = await this.withCheckTimeout(
        this.runLatestVersionLookup(this.runtime.packageName)
      );
      const availability =
        compareVersions(latestVersion, this.runtime.currentVersion) > 0
          ? "update_available"
          : "up_to_date";

      return this.persistAndBroadcast(
        {
          currentVersion: this.runtime.currentVersion,
          latestVersion,
          availability,
          updateStatus: "idle",
          lastCheckedAt: this.now(),
          errorSummary: null,
          requiresManualStep: false,
          manualCommand: null,
        },
        false
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.persistAndBroadcast(
        {
          currentVersion: this.runtime.currentVersion,
          availability: "check_failed",
          updateStatus: "idle",
          lastCheckedAt: this.now(),
          errorSummary: message,
        },
        false
      );
    }
  }

  private async withCheckTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Update check timed out after ${UpdateService.CHECK_TIMEOUT_MS}ms`));
          }, UpdateService.CHECK_TIMEOUT_MS);
          timeoutHandle.unref?.();
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private persistAndBroadcast(
    patch: Partial<UpdateStateSnapshot>,
    includeInFlightCheck = true
  ): UpdateStateView {
    const snapshot = this.deps.updateStateRepo.update((current) => ({
      ...patch,
      currentVersion: patch.currentVersion ?? current.currentVersion,
    }));
    const view = this.composeStateView(snapshot, { includeInFlightCheck });
    this.deps.broadcaster.broadcast("update.state.changed", view);
    return view;
  }
}
