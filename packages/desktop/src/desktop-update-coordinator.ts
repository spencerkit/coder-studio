import {
  createDefaultProductUpdateState,
  type DesktopUpdateSettings,
  type ProductUpdateComponent,
  type ProductUpdateState,
  type UpdateComponentId,
  type UpdateRuntimeContext,
} from "@coder-studio/core";
import type { DesktopBuildInfo } from "./build-info.js";
import type { DesktopChannel, DesktopChannelRuntime } from "./desktop-channel.js";
import type { DesktopUpdateJournal, DesktopUpdateJournalRecord } from "./desktop-update-journal.js";
import type { DesktopUpdateSettingsRepo } from "./desktop-update-settings.js";
import { compareVersions } from "./runtime-manifest.js";
import type { RuntimeUpdateAdapter, RuntimeUpdateMetadata } from "./runtime-update-manager.js";
import type { DesktopShellUpdateAdapter, ShellUpdateMetadata } from "./update-manager.js";

export interface DesktopUpdateCoordinatorDeps {
  runtimeContext: UpdateRuntimeContext;
  currentProductVersion: () => string;
  currentProductPublishedAt: () => string | null;
  getBuildInfo: () => DesktopBuildInfo;
  loadChannel: () => Promise<DesktopChannel>;
  shell: DesktopShellUpdateAdapter;
  getRuntimeAdapter: (
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ) => Promise<RuntimeUpdateAdapter>;
  initialRuntimeTarget: "win32-x64" | "linux-x64";
  initialEnvironmentId: string;
  settings: DesktopUpdateSettingsRepo;
  journal: DesktopUpdateJournal;
  now: () => number;
  randomId: () => string;
  onStateChanged: (state: ProductUpdateState) => void;
  relaunch: () => void;
  quit: () => void;
}

type BusyPhase = "checking" | "downloading" | "restarting";

function updateError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function targetFromComponent(id: UpdateComponentId): "win32-x64" | "linux-x64" | null {
  if (id === "runtime:win32-x64") return "win32-x64";
  if (id === "runtime:linux-x64") return "linux-x64";
  return id === "shell" ? "win32-x64" : null;
}

export class DesktopUpdateCoordinator {
  private state: ProductUpdateState;
  private runtimeTarget: "win32-x64" | "linux-x64";
  private runtimeEnvironmentId: string;
  private runtimeContext: UpdateRuntimeContext;
  private runtimeAdapter: RuntimeUpdateAdapter | null = null;
  private runtimeMetadata: RuntimeUpdateMetadata | null = null;
  private shellMetadata: ShellUpdateMetadata | null = null;
  private busyPhase: BusyPhase | null = null;
  private controllers = new Map<UpdateComponentId, AbortController>();
  private cancelRequested = false;
  private restartIntent = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DesktopUpdateCoordinatorDeps) {
    this.assertDesktopContext(deps.runtimeContext);
    this.runtimeContext = deps.runtimeContext;
    this.runtimeTarget = deps.initialRuntimeTarget;
    this.runtimeEnvironmentId = deps.initialEnvironmentId;
    this.state = this.createBaseState();
  }

  async start(): Promise<void> {
    const journal = await this.deps.journal.read();
    if (journal) this.restoreJournal(journal);
    const settings = await this.deps.settings.get();
    this.schedule(settings);
    this.publish();
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    for (const controller of this.controllers.values()) controller.abort();
    if (this.busyPhase === "downloading") this.deps.shell.cancelDownload();
    this.controllers.clear();
    if (!this.restartIntent) this.deps.shell.disarmInstallOnQuit();
  }

  getState(): ProductUpdateState {
    return this.cloneState();
  }

  async check(options: { manual: boolean }): Promise<ProductUpdateState> {
    if (
      !options.manual &&
      (this.state.status === "ready" ||
        this.state.status === "restarting" ||
        this.state.status === "succeeded")
    ) {
      return this.getState();
    }
    this.assertNotBusy();
    this.busyPhase = "checking";
    this.state = {
      ...this.state,
      status: "checking",
      errorSummary: null,
      diagnostics: {
        ...this.state.diagnostics,
        failedComponentId: null,
        failedPhase: null,
      },
    };
    this.publish();
    try {
      const channel = await this.deps.loadChannel();
      const buildInfo = this.deps.getBuildInfo();
      const runtimeEntry = channel.runtimes[this.runtimeTarget];
      const plannedShellVersion =
        compareVersions(channel.shell.version, buildInfo.shellVersion) > 0
          ? channel.shell.version
          : buildInfo.shellVersion;
      const runtimeAdapter = await this.deps.getRuntimeAdapter(
        this.runtimeTarget,
        this.runtimeEnvironmentId
      );
      const [shellMetadata, runtimeMetadata] = await Promise.all([
        this.deps.shell.checkMetadata(channel.shell),
        runtimeAdapter.checkMetadata(runtimeEntry, plannedShellVersion),
      ]);
      this.assertSourceMatchesChannel(channel, shellMetadata, runtimeMetadata);
      this.runtimeAdapter = runtimeAdapter;
      this.shellMetadata = shellMetadata;
      this.runtimeMetadata = runtimeMetadata;
      const components = this.createNeededComponents(
        buildInfo,
        runtimeEntry,
        shellMetadata,
        runtimeMetadata
      );
      const compatibility = this.validatePlan(channel, buildInfo, components, runtimeMetadata);
      const checkedAt = this.deps.now();
      if (components.length === 0) {
        await this.deps.journal.clear();
        this.state = {
          ...this.createBaseState(),
          status: "idle",
          lastCheckedAt: checkedAt,
        };
      } else {
        const timestamp = new Date(checkedAt).toISOString();
        this.state = {
          ...this.createBaseState(),
          status: compatibility.compatible ? "available" : "failed",
          planId: this.deps.randomId(),
          createdAt: timestamp,
          updatedAt: timestamp,
          lastCheckedAt: checkedAt,
          components: components.map((component) => ({
            ...component,
            status: compatibility.compatible ? "available" : "failed",
          })),
          compatibility,
          diagnostics: this.createDiagnostics(buildInfo),
          errorSummary: compatibility.summary,
        };
        await this.persistPlan();
      }
      return this.publish();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.state = {
        ...this.state,
        status: "failed",
        lastCheckedAt: this.deps.now(),
        errorSummary: normalized.message,
        diagnostics: {
          ...this.state.diagnostics,
          failedPhase: "checking",
        },
      };
      this.publish();
      throw normalized;
    } finally {
      this.busyPhase = null;
    }
  }

  download(): Promise<ProductUpdateState> {
    return this.downloadComponents(false);
  }

  retryFailed(): Promise<ProductUpdateState> {
    return this.downloadComponents(true);
  }

  cancelDownload(): ProductUpdateState {
    if (this.busyPhase !== "downloading") return this.getState();
    this.cancelRequested = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.deps.shell.cancelDownload();
    this.state = {
      ...this.state,
      status: "available",
      components: this.state.components.map((component) =>
        component.verified
          ? component
          : { ...component, status: "available", progressPercent: null, errorSummary: null }
      ),
      errorSummary: null,
    };
    return this.publish();
  }

  async prepareRestart(): Promise<ProductUpdateState> {
    this.assertNotBusy();
    if (
      this.state.status !== "ready" ||
      !this.state.compatibility.compatible ||
      this.state.components.some((component) => !component.verified)
    ) {
      throw updateError("update_not_ready", "The Desktop update plan is not ready to restart");
    }
    this.restartIntent = true;
    if (this.state.components.some((component) => component.id === "shell")) {
      this.deps.shell.armInstallOnQuit();
    }
    this.state = {
      ...this.state,
      status: "restarting",
      updatedAt: this.timestamp(),
      components: this.state.components.map((component) => ({
        ...component,
        status: "restarting",
      })),
    };
    await this.persistPlan();
    return this.publish();
  }

  async restartAndInstall(): Promise<boolean> {
    if (!this.restartIntent || this.state.status !== "restarting") return false;
    if (this.busyPhase) return false;
    this.busyPhase = "restarting";
    if (this.state.components.some((component) => component.id === "shell")) {
      this.deps.shell.quitAndInstall();
    } else {
      this.deps.relaunch();
      this.deps.quit();
    }
    return true;
  }

  getSettings(): Promise<DesktopUpdateSettings> {
    return this.deps.settings.get();
  }

  async setSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings> {
    const settings = await this.deps.settings.set(patch);
    this.schedule(settings);
    return settings;
  }

  async prepareEnvironmentTarget(
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ): Promise<void> {
    this.assertNotBusy();
    this.busyPhase = "checking";
    try {
      const [channel, adapter] = await Promise.all([
        this.deps.loadChannel(),
        this.deps.getRuntimeAdapter(target, environmentId),
      ]);
      const buildInfo = this.deps.getBuildInfo();
      const expected = channel.runtimes[target];
      const metadata = await adapter.checkMetadata(expected, buildInfo.shellVersion);
      if (compareVersions(metadata.version, this.deps.currentProductVersion()) <= 0) return;
      this.assertSourceMatchesRuntime(expected, metadata, target);
      this.busyPhase = "downloading";
      const controller = new AbortController();
      await adapter.downloadAndStage(metadata, {
        signal: controller.signal,
        onProgress: () => {},
        explicitRetry: false,
      });
    } finally {
      this.busyPhase = null;
    }
  }

  async setActiveRuntimeTarget(
    target: "win32-x64" | "linux-x64",
    environmentId: string,
    runtimeContext: UpdateRuntimeContext
  ): Promise<ProductUpdateState> {
    this.assertNotBusy();
    this.assertDesktopContext(runtimeContext);
    this.runtimeTarget = target;
    this.runtimeEnvironmentId = environmentId;
    this.runtimeContext = runtimeContext;
    this.runtimeAdapter = null;
    this.runtimeMetadata = null;
    if (this.state.status !== "ready" && this.state.status !== "restarting") {
      this.state = this.createBaseState();
    } else {
      this.state = { ...this.state, runtimeContext };
    }
    return this.publish();
  }

  async reconcileOnStartup(actual: {
    shellVersion: string;
    runtimeVersion: string;
    pendingRuntimeVersion: string | null;
  }): Promise<ProductUpdateState> {
    const journal = await this.deps.journal.read();
    if (!journal) {
      this.state = this.createBaseState();
      return this.publish();
    }
    this.restoreJournal(journal);
    const components = this.state.components.map((component) => {
      const installed =
        component.id === "shell"
          ? actual.shellVersion === component.targetVersion
          : actual.runtimeVersion === component.targetVersion;
      return installed
        ? { ...component, status: "succeeded" as const, downloaded: true, verified: true }
        : component;
    });
    if (components.every((component) => component.status === "succeeded")) {
      const runtime = components.find((component) => component.kind === "runtime");
      this.state = {
        ...this.state,
        status: "succeeded",
        productVersion: runtime?.targetVersion ?? actual.runtimeVersion,
        productPublishedAt: runtime?.targetPublishedAt ?? this.state.productPublishedAt,
        components,
        restartRequired: false,
        errorSummary: null,
      };
      this.restartIntent = false;
      await this.deps.journal.clear();
      return this.publish();
    }
    const shell = components.find((component) => component.id === "shell");
    const runtime = components.find((component) => component.kind === "runtime");
    if (
      journal.restartIntent &&
      shell &&
      shell.status !== "succeeded" &&
      runtime?.targetVersion === actual.pendingRuntimeVersion
    ) {
      this.state = {
        ...this.state,
        status: "failed",
        components,
        errorSummary: "Desktop Shell installation did not reach the planned version",
        diagnostics: {
          ...this.state.diagnostics,
          failedComponentId: "shell",
          failedPhase: "installing",
          recoveryAction: this.deps.shell.getDiagnostics().recoveryAction,
        },
      };
      this.restartIntent = false;
      this.deps.shell.disarmInstallOnQuit();
      await this.persistPlan();
      return this.publish();
    }
    this.state = {
      ...this.state,
      components,
      status: journal.status === "ready" ? "ready" : "failed",
      errorSummary:
        journal.status === "ready" ? null : "The previous Desktop update did not complete",
    };
    return this.publish();
  }

  private async downloadComponents(explicitRetry: boolean): Promise<ProductUpdateState> {
    this.assertNotBusy();
    if (!this.state.compatibility.compatible) {
      throw updateError("update_incompatible", "The Desktop update plan is incompatible");
    }
    const selected = this.state.components.filter((component) =>
      explicitRetry ? !component.verified && component.status === "failed" : !component.verified
    );
    if (selected.length === 0) {
      if (
        this.state.components.length > 0 &&
        this.state.components.every((item) => item.verified)
      ) {
        this.state = { ...this.state, status: "ready", restartRequired: true };
        return this.publish();
      }
      throw updateError(
        "update_not_available",
        "There are no Desktop update components to download"
      );
    }
    if (!this.runtimeAdapter && selected.some((component) => component.kind === "runtime")) {
      throw updateError("update_plan_invalid", "The Runtime update adapter is unavailable");
    }
    this.busyPhase = "downloading";
    this.cancelRequested = false;
    this.state = {
      ...this.state,
      status: "downloading",
      updatedAt: this.timestamp(),
      errorSummary: null,
      components: this.state.components.map((component) =>
        selected.some((entry) => entry.id === component.id)
          ? { ...component, status: "downloading", errorSummary: null }
          : component
      ),
    };
    this.publish();

    const tasks = selected.map(async (component) => {
      const controller = new AbortController();
      this.controllers.set(component.id, controller);
      try {
        if (component.id === "shell") {
          if (!this.shellMetadata) throw new Error("Shell update metadata is unavailable");
          await this.deps.shell.download(this.shellMetadata, (percent) =>
            this.updateProgress(component.id, percent)
          );
        } else {
          if (!this.runtimeMetadata || !this.runtimeAdapter) {
            throw new Error("Runtime update metadata is unavailable");
          }
          await this.runtimeAdapter.downloadAndStage(this.runtimeMetadata, {
            signal: controller.signal,
            onProgress: (percent) => this.updateProgress(component.id, percent),
            explicitRetry,
          });
        }
        this.updateComponent(component.id, {
          status: "ready",
          progressPercent: 100,
          downloaded: true,
          verified: true,
          errorSummary: null,
        });
      } catch (error) {
        if (this.cancelRequested) return;
        const summary = error instanceof Error ? error.message : String(error);
        this.updateComponent(component.id, {
          status: "failed",
          progressPercent: null,
          errorSummary: summary,
        });
      } finally {
        this.controllers.delete(component.id);
      }
    });
    await Promise.allSettled(tasks);
    this.busyPhase = null;
    if (this.cancelRequested) {
      this.state = {
        ...this.state,
        status: "available",
        updatedAt: this.timestamp(),
        components: this.state.components.map((component) =>
          component.verified
            ? component
            : { ...component, status: "available", progressPercent: null, errorSummary: null }
        ),
      };
    } else {
      const failed = this.state.components.find((component) => component.status === "failed");
      this.state = failed
        ? {
            ...this.state,
            status: "failed",
            updatedAt: this.timestamp(),
            errorSummary: failed.errorSummary,
            diagnostics: {
              ...this.state.diagnostics,
              failedComponentId: failed.id,
              failedPhase: "downloading",
            },
          }
        : {
            ...this.state,
            status: "ready",
            updatedAt: this.timestamp(),
            restartRequired: true,
            errorSummary: null,
          };
    }
    await this.persistPlan();
    return this.publish();
  }

  private createNeededComponents(
    buildInfo: DesktopBuildInfo,
    runtimeEntry: DesktopChannelRuntime,
    shellMetadata: ShellUpdateMetadata,
    runtimeMetadata: RuntimeUpdateMetadata
  ): ProductUpdateComponent[] {
    const components: ProductUpdateComponent[] = [];
    if (shellMetadata.updateNeeded) {
      components.push({
        id: "shell",
        kind: "shell",
        target: "win32-x64",
        currentVersion: buildInfo.shellVersion,
        currentPublishedAt: buildInfo.publishedAt,
        targetVersion: shellMetadata.version,
        targetPublishedAt: shellMetadata.publishedAt,
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      });
    }
    if (compareVersions(runtimeMetadata.version, this.deps.currentProductVersion()) > 0) {
      components.push({
        id: runtimeMetadata.componentId,
        kind: "runtime",
        target: this.runtimeTarget,
        currentVersion: this.deps.currentProductVersion(),
        currentPublishedAt: this.deps.currentProductPublishedAt(),
        targetVersion: runtimeEntry.version,
        targetPublishedAt: runtimeEntry.publishedAt,
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      });
    }
    return components;
  }

  private validatePlan(
    channel: DesktopChannel,
    buildInfo: DesktopBuildInfo,
    components: ProductUpdateComponent[],
    runtime: RuntimeUpdateMetadata
  ): ProductUpdateState["compatibility"] {
    const shellIncluded = components.some((component) => component.id === "shell");
    const runtimeIncluded = components.some((component) => component.kind === "runtime");
    const host = shellIncluded ? channel.shell : buildInfo;
    const capabilityPairs: Array<[unknown, unknown]> = [
      [runtime.manifest.requiredEngineVersion, host.engineVersion],
      [runtime.manifest.requiredNodeVersion, host.nodeVersion],
      [runtime.manifest.runtimeHostApiVersion, host.runtimeHostApiVersion],
      [runtime.manifest.apiProtocolVersion, host.apiProtocolVersion],
      [runtime.manifest.dataSchemaVersion, host.dataSchemaVersion],
    ];
    const target = `${runtime.manifest.platform}-${runtime.manifest.arch}`;
    if (
      target !== this.runtimeTarget ||
      capabilityPairs.some(([required, actual]) => required !== actual) ||
      compareVersions(
        shellIncluded ? channel.shell.version : buildInfo.shellVersion,
        runtime.manifest.minShellVersion
      ) < 0
    ) {
      return {
        compatible: false,
        code: "runtime_host_incompatible",
        summary: "The selected Runtime is incompatible with the planned Desktop Shell",
      };
    }
    if (shellIncluded && !runtimeIncluded) {
      const currentCapabilities = [
        buildInfo.engineVersion,
        buildInfo.nodeVersion,
        buildInfo.runtimeHostApiVersion,
        buildInfo.apiProtocolVersion,
        buildInfo.dataSchemaVersion,
      ];
      const targetCapabilities = [
        channel.shell.engineVersion,
        channel.shell.nodeVersion,
        channel.shell.runtimeHostApiVersion,
        channel.shell.apiProtocolVersion,
        channel.shell.dataSchemaVersion,
      ];
      if (currentCapabilities.some((value, index) => value !== targetCapabilities[index])) {
        return {
          compatible: false,
          code: "shell_breaks_current_runtime",
          summary: "The target Desktop Shell cannot safely carry the current Runtime",
        };
      }
    }
    return { compatible: true, code: null, summary: null };
  }

  private assertSourceMatchesChannel(
    channel: DesktopChannel,
    shell: ShellUpdateMetadata,
    runtime: RuntimeUpdateMetadata
  ): void {
    if (
      shell.version !== channel.shell.version ||
      shell.publishedAt !== channel.shell.publishedAt
    ) {
      throw new Error("Desktop Shell source does not match signed Desktop channel");
    }
    this.assertSourceMatchesRuntime(
      channel.runtimes[this.runtimeTarget],
      runtime,
      this.runtimeTarget
    );
  }

  private assertSourceMatchesRuntime(
    expected: DesktopChannelRuntime,
    runtime: RuntimeUpdateMetadata,
    target: "win32-x64" | "linux-x64"
  ): void {
    if (
      runtime.componentId !== `runtime:${target}` ||
      runtime.version !== expected.version ||
      runtime.publishedAt !== expected.publishedAt
    ) {
      throw new Error("Runtime source does not match signed Desktop channel");
    }
  }

  private createBaseState(): ProductUpdateState {
    const state = createDefaultProductUpdateState(
      this.runtimeContext,
      this.deps.currentProductVersion(),
      this.deps.currentProductPublishedAt()
    );
    return {
      ...state,
      diagnostics: this.createDiagnostics(this.deps.getBuildInfo()),
    };
  }

  private createDiagnostics(buildInfo: DesktopBuildInfo): ProductUpdateState["diagnostics"] {
    const shell = this.deps.shell.getDiagnostics();
    return {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: buildInfo.shellVersion,
      shellPublishedAt: buildInfo.publishedAt,
      shellBuiltAt: buildInfo.builtAt,
      engineVersion: buildInfo.engineVersion,
      nodeVersion: buildInfo.nodeVersion,
      runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
      apiProtocolVersion: buildInfo.apiProtocolVersion,
      dataSchemaVersion: buildInfo.dataSchemaVersion,
      logLocations: shell.logLocations,
      recoveryAction: shell.recoveryAction,
    };
  }

  private updateProgress(id: UpdateComponentId, percent: number): void {
    const component = this.state.components.find((entry) => entry.id === id);
    const previous = component?.progressPercent ?? 0;
    this.updateComponent(id, {
      progressPercent: Math.max(previous, Math.max(0, Math.min(100, percent))),
    });
    this.publish();
  }

  private updateComponent(id: UpdateComponentId, patch: Partial<ProductUpdateComponent>): void {
    this.state = {
      ...this.state,
      components: this.state.components.map((component) =>
        component.id === id ? { ...component, ...patch } : component
      ),
    };
  }

  private async persistPlan(): Promise<void> {
    if (!this.state.planId || !this.state.createdAt || this.state.components.length === 0) return;
    const status: DesktopUpdateJournalRecord["status"] =
      this.state.status === "downloading"
        ? "downloading"
        : this.state.status === "ready"
          ? "ready"
          : this.state.status === "restarting"
            ? "restarting"
            : this.state.status === "failed"
              ? "failed"
              : "available";
    const failed = this.state.components.find((component) => component.errorSummary);
    await this.deps.journal.write({
      schemaVersion: 1,
      planId: this.state.planId,
      status,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt ?? this.timestamp(),
      runtimeTarget: this.runtimeTarget,
      compatibility: this.state.compatibility,
      restartIntent: this.restartIntent,
      components: this.state.components.map((component) => ({
        id: component.id,
        currentVersion: component.currentVersion,
        targetVersion: component.targetVersion as string,
        currentPublishedAt: component.currentPublishedAt,
        targetPublishedAt: component.targetPublishedAt as string,
        downloaded: component.downloaded,
        verified: component.verified,
        installed: component.status === "succeeded",
        errorSummary: component.errorSummary,
      })),
      lastError: failed
        ? {
            componentId: failed.id,
            phase: this.state.diagnostics.failedPhase ?? "unknown",
            summary: failed.errorSummary as string,
          }
        : null,
    });
  }

  private restoreJournal(journal: DesktopUpdateJournalRecord): void {
    this.runtimeTarget = journal.runtimeTarget;
    this.restartIntent = journal.restartIntent;
    const status = journal.status;
    this.state = {
      ...this.createBaseState(),
      status,
      planId: journal.planId,
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
      components: journal.components.map((component) => ({
        id: component.id,
        kind: component.id === "shell" ? "shell" : "runtime",
        target: targetFromComponent(component.id),
        currentVersion: component.currentVersion,
        currentPublishedAt: component.currentPublishedAt,
        targetVersion: component.targetVersion,
        targetPublishedAt: component.targetPublishedAt,
        status: component.installed
          ? "succeeded"
          : component.verified
            ? status === "restarting"
              ? "restarting"
              : "ready"
            : status,
        progressPercent: component.downloaded ? 100 : null,
        downloaded: component.downloaded,
        verified: component.verified,
        errorSummary: component.errorSummary,
      })),
      compatibility: journal.compatibility,
      diagnostics: {
        ...this.createDiagnostics(this.deps.getBuildInfo()),
        failedComponentId: journal.lastError?.componentId ?? null,
        failedPhase: journal.lastError?.phase ?? null,
      },
      restartRequired: status === "ready" || status === "restarting",
      errorSummary: journal.lastError?.summary ?? null,
    };
    if (journal.restartIntent && journal.components.every((component) => component.verified)) {
      if (journal.components.some((component) => component.id === "shell")) {
        this.deps.shell.armInstallOnQuit();
      }
    }
  }

  private schedule(settings: DesktopUpdateSettings): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    if (!settings.autoCheckEnabled) return;
    this.startupTimer = setTimeout(() => {
      void this.check({ manual: false }).catch(() => {});
    }, 15_000);
    this.startupTimer.unref?.();
    this.intervalTimer = setInterval(() => {
      void this.check({ manual: false }).catch(() => {});
    }, settings.checkIntervalSec * 1000);
    this.intervalTimer.unref?.();
  }

  private assertDesktopContext(context: UpdateRuntimeContext): void {
    if (
      context.authority !== "desktop" ||
      !context.supported ||
      (context.environment !== "desktop-native" && context.environment !== "desktop-wsl")
    ) {
      throw new Error("Desktop update authority requires a supported Desktop runtime context");
    }
  }

  private assertNotBusy(): void {
    if (this.busyPhase) {
      throw updateError("update_busy", `Desktop update is busy with ${this.busyPhase}`);
    }
  }

  private timestamp(): string {
    return new Date(this.deps.now()).toISOString();
  }

  private cloneState(): ProductUpdateState {
    return {
      ...this.state,
      runtimeContext: { ...this.state.runtimeContext },
      components: this.state.components.map((component) => ({ ...component })),
      compatibility: { ...this.state.compatibility },
      diagnostics: {
        ...this.state.diagnostics,
        logLocations: [...this.state.diagnostics.logLocations],
      },
    };
  }

  private publish(): ProductUpdateState {
    const state = this.cloneState();
    this.deps.onStateChanged(state);
    return state;
  }
}
