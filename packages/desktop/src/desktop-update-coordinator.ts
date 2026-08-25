import {
  createDefaultProductUpdateState,
  type DesktopUpdateSettings,
  type ProductUpdateComponent,
  type ProductUpdateState,
  type UpdateComponentId,
  type UpdateRuntimeContext,
} from "@coder-studio/core";
import type { DesktopBuildInfo } from "./build-info.js";
import type { DesktopChannel } from "./desktop-channel.js";
import type { DesktopUpdateJournal, DesktopUpdateJournalRecord } from "./desktop-update-journal.js";
import type { DesktopUpdateSettingsRepo } from "./desktop-update-settings.js";
import type { ProductChannelRuntime, ProductRelease } from "./product-channel.js";
import {
  type ProductCompatibilityHost,
  type ProductReleaseSource,
  selectHighestCompatibleProductRelease,
} from "./product-index.js";
import { compareVersions, type RuntimeManifest } from "./runtime-manifest.js";
import type { RuntimeUpdateAdapter, RuntimeUpdateMetadata } from "./runtime-update-manager.js";
import type { DesktopShellUpdateAdapter, ShellUpdateMetadata } from "./update-manager.js";

type RuntimeTarget = "win32-x64" | "linux-x64";

export interface DesktopUpdateCoordinatorDeps {
  runtimeContext: UpdateRuntimeContext;
  currentProductVersion: () => string;
  currentSharedWebVersion: () => string;
  currentProductPublishedAt: () => string | null;
  getBuildInfo: () => DesktopBuildInfo;
  loadProductChannel: () => Promise<ProductReleaseSource>;
  loadDesktopChannel: () => Promise<DesktopChannel>;
  shell: DesktopShellUpdateAdapter;
  getRuntimeAdapter: (
    target: RuntimeTarget,
    environmentId: string
  ) => Promise<RuntimeUpdateAdapter>;
  initialRuntimeTarget: RuntimeTarget;
  initialEnvironmentId: string;
  settings: DesktopUpdateSettingsRepo;
  journal: DesktopUpdateJournal;
  journalLocation: string;
  updateOwnerId: string;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function targetFromComponent(id: UpdateComponentId): "win32-x64" | "linux-x64" | null {
  if (id === "runtime:win32-x64") return "win32-x64";
  if (id === "runtime:linux-x64") return "linux-x64";
  return id === "shell" ? "win32-x64" : null;
}

interface CheckedRuntime {
  target: RuntimeTarget;
  adapter: RuntimeUpdateAdapter;
  currentManifest: RuntimeManifest;
  metadata: RuntimeUpdateMetadata | null;
}

interface StartupComponentVersions {
  shellVersion: string;
  runtimeVersion: string;
  pendingRuntimeVersion: string | null;
  sharedWebVersion?: string;
  pendingSharedWebVersion?: string | null;
}

export class DesktopUpdateCoordinator {
  private state: ProductUpdateState;
  private runtimeTarget: RuntimeTarget;
  private runtimeEnvironmentId: string;
  private runtimeContext: UpdateRuntimeContext;
  private runtimeAdapters = new Map<RuntimeTarget, RuntimeUpdateAdapter>();
  private runtimeMetadata = new Map<RuntimeTarget, RuntimeUpdateMetadata>();
  private shellMetadata: ShellUpdateMetadata | null = null;
  private busyPhase: BusyPhase | null = null;
  private controllers = new Map<UpdateComponentId, AbortController>();
  private activeOperations = new Set<Promise<unknown>>();
  private cancelRequested = false;
  private restartIntent = false;
  private startupReconciled = false;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private journalWriteQueue: Promise<void> = Promise.resolve();
  private journalPlanId: string | null = null;
  private stopping = false;

  constructor(private readonly deps: DesktopUpdateCoordinatorDeps) {
    this.assertDesktopContext(deps.runtimeContext);
    this.runtimeContext = deps.runtimeContext;
    this.runtimeTarget = deps.initialRuntimeTarget;
    this.runtimeEnvironmentId = deps.initialEnvironmentId;
    this.state = this.createBaseState();
  }

  async start(): Promise<void> {
    if (!this.startupReconciled) {
      const ownsUpdates = await this.ensureUpdateOwnership(false);
      const journal = await this.deps.journal.read();
      if (journal) {
        this.journalPlanId = journal.planId;
        if (!ownsUpdates) {
          this.restoreReadOnlyJournal(journal);
        } else if (journal.environmentId === this.runtimeEnvironmentId) {
          this.restoreJournal(journal);
        } else {
          this.restoreForeignEnvironmentJournal(journal);
        }
      } else if (!ownsUpdates) {
        this.restoreReadOnlyWithoutJournal();
      }
    }
    const settings = await this.deps.settings.get();
    this.schedule(settings);
    this.publish();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    for (const controller of this.controllers.values()) controller.abort();
    if (this.busyPhase === "downloading") this.deps.shell.cancelDownload();
    await Promise.allSettled([...this.activeOperations]);
    this.controllers.clear();
    if (!this.restartIntent) this.deps.shell.disarmInstallOnQuit();
    await this.journalWriteQueue.catch(() => {});
    if (!this.restartIntent) {
      await this.deps.journal.releaseOwner(this.deps.updateOwnerId);
    }
  }

  getState(): ProductUpdateState {
    return this.cloneState();
  }

  async check(options: { manual: boolean }): Promise<ProductUpdateState> {
    if (!(await this.ensureUpdateOwnership(options.manual))) return this.getState();
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
      this.runtimeAdapters.clear();
      this.runtimeMetadata.clear();
      this.shellMetadata = null;
      const [productResult, desktopResult] = await Promise.allSettled([
        this.deps.loadProductChannel(),
        this.deps.loadDesktopChannel(),
      ]);
      let productChannelError =
        productResult.status === "rejected" ? errorMessage(productResult.reason) : null;
      let desktopChannelError =
        desktopResult.status === "rejected" ? errorMessage(desktopResult.reason) : null;
      const productSource = productResult.status === "fulfilled" ? productResult.value : null;
      let productChannel: ProductRelease | null = null;
      let desktopChannel = desktopResult.status === "fulfilled" ? desktopResult.value : null;
      const buildInfo = this.deps.getBuildInfo();
      let shellMetadata: ShellUpdateMetadata | null = null;
      if (desktopChannel) {
        try {
          shellMetadata = await this.deps.shell.checkMetadata(desktopChannel);
          this.assertSourceMatchesShell(desktopChannel, shellMetadata);
        } catch (error) {
          desktopChannelError = errorMessage(error);
          desktopChannel = null;
          shellMetadata = null;
        }
      }
      const plannedShellVersion =
        desktopChannel && compareVersions(desktopChannel.shell.version, buildInfo.shellVersion) > 0
          ? desktopChannel.shell.version
          : buildInfo.shellVersion;
      if (productSource) {
        try {
          const plannedHost = this.productCompatibilityHost(
            desktopChannel &&
              compareVersions(desktopChannel.shell.version, buildInfo.shellVersion) > 0
              ? desktopChannel.shell
              : buildInfo
          );
          const selected = selectHighestCompatibleProductRelease(productSource, plannedHost);
          if (!selected) {
            throw new Error(
              `No accepted Product Runtime is compatible with Desktop Shell ${plannedHost.shellVersion}`
            );
          }
          productChannel = selected;
        } catch (error) {
          productChannelError = errorMessage(error);
          productChannel = null;
        }
      }
      let checkedRuntimes = await Promise.all(
        this.runtimeTargetsForCheck().map(async (target): Promise<CheckedRuntime> => {
          const adapter = await this.deps.getRuntimeAdapter(
            target,
            this.environmentIdForTarget(target)
          );
          return {
            target,
            adapter,
            currentManifest: await adapter.getCurrentManifest(),
            metadata: null,
          };
        })
      );
      for (const checked of checkedRuntimes) {
        this.runtimeAdapters.set(checked.target, checked.adapter);
      }
      if (productChannel) {
        const acceptedProductChannel = productChannel;
        const checkedProductRuntimes = await Promise.allSettled(
          checkedRuntimes.map(async (checked): Promise<CheckedRuntime> => {
            const metadata = await checked.adapter.checkMetadata(
              acceptedProductChannel.runtimes[checked.target],
              plannedShellVersion,
              acceptedProductChannel.releaseTag
            );
            this.assertSourceMatchesRuntime(
              acceptedProductChannel.runtimes[checked.target],
              metadata,
              checked.target
            );
            return { ...checked, metadata };
          })
        );
        const failures = checkedProductRuntimes.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failures.length > 0) {
          productChannelError = failures.map((result) => errorMessage(result.reason)).join("; ");
          productChannel = null;
        } else {
          checkedRuntimes = checkedProductRuntimes.map(
            (result) => (result as PromiseFulfilledResult<CheckedRuntime>).value
          );
          for (const checked of checkedRuntimes) {
            if (checked.metadata) this.runtimeMetadata.set(checked.target, checked.metadata);
          }
        }
      }
      this.state = {
        ...this.state,
        diagnostics: {
          ...this.state.diagnostics,
          productChannelError,
          desktopChannelError,
        },
      };
      if (!productChannel && !desktopChannel) {
        throw new AggregateError(
          [productChannelError, desktopChannelError]
            .filter((message): message is string => Boolean(message))
            .map((message) => new Error(message)),
          "Product and Desktop update channels are unavailable"
        );
      }
      this.shellMetadata = shellMetadata;
      const components = this.createNeededComponents(
        productChannel,
        buildInfo,
        shellMetadata,
        checkedRuntimes
      );
      const compatibility = this.validatePlan(
        productChannel,
        desktopChannel,
        buildInfo,
        components,
        checkedRuntimes
      );
      const checkedAt = this.deps.now();
      if (components.length === 0) {
        await this.clearJournal();
        const channelError = productChannelError ?? desktopChannelError;
        this.state = {
          ...this.createBaseState(),
          status: channelError ? "failed" : "idle",
          lastCheckedAt: checkedAt,
          diagnostics: {
            ...this.createDiagnostics(buildInfo),
            productChannelError,
            desktopChannelError,
            failedPhase: channelError ? "checking" : null,
          },
          errorSummary: channelError,
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
          diagnostics: {
            ...this.createDiagnostics(buildInfo),
            productChannelError,
            desktopChannelError,
          },
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

  async retryFailed(): Promise<ProductUpdateState> {
    await this.ensureUpdateOwnership(true);
    const failedPlanNeedsRecheck =
      this.state.status === "failed" &&
      this.state.components.some((component) => component.status === "available");
    const failedWithoutMetadata = this.state.components.some((component) => {
      const target = targetFromComponent(component.id);
      return (
        component.status === "failed" &&
        !component.verified &&
        ((component.kind === "runtime" &&
          (!target || !this.runtimeAdapters.has(target) || !this.runtimeMetadata.has(target))) ||
          (component.kind === "shell" && !this.shellMetadata))
      );
    });
    if (failedPlanNeedsRecheck || failedWithoutMetadata) {
      await this.check({ manual: true });
      return this.downloadComponents(false);
    }
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
    this.assertUpdateOwnership();
    this.assertNotBusy();
    if (
      this.state.status !== "ready" ||
      !this.state.compatibility.compatible ||
      this.state.components.some((component) => !component.verified)
    ) {
      throw updateError("update_not_ready", "The Desktop update plan is not ready to restart");
    }
    const previousState = this.state;
    const previousRestartIntent = this.restartIntent;
    const includesShell = this.state.components.some((component) => component.id === "shell");
    this.restartIntent = true;
    this.state = {
      ...this.state,
      status: "restarting",
      updatedAt: this.timestamp(),
      components: this.state.components.map((component) => ({
        ...component,
        status: "restarting",
      })),
    };
    try {
      await this.persistPlan();
    } catch (error) {
      this.state = previousState;
      this.restartIntent = previousRestartIntent;
      if (includesShell) this.deps.shell.disarmInstallOnQuit();
      this.publish();
      throw error;
    }
    if (includesShell) this.deps.shell.armInstallOnQuit();
    return this.publish();
  }

  async restartAndInstall(): Promise<boolean> {
    if (!this.restartIntent || this.state.status !== "restarting") return false;
    if (this.busyPhase) return false;
    this.assertUpdateOwnership();
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

  prepareEnvironmentTarget(
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ): Promise<void> {
    return this.trackActiveOperation(this.prepareEnvironmentTargetInternal(target, environmentId));
  }

  private async prepareEnvironmentTargetInternal(
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ): Promise<void> {
    if (!(await this.ensureUpdateOwnership(false))) return;
    this.assertNotBusy();
    this.busyPhase = "checking";
    try {
      const [channel, adapter] = await Promise.all([
        this.deps.loadProductChannel(),
        this.deps.getRuntimeAdapter(target, environmentId),
      ]);
      const buildInfo = this.deps.getBuildInfo();
      const host = this.productCompatibilityHost(buildInfo);
      const selected = selectHighestCompatibleProductRelease(channel, host);
      if (!selected) {
        throw new Error(
          `No accepted Product Runtime is compatible with Desktop Shell ${host.shellVersion}`
        );
      }
      const expected = selected.runtimes[target];
      const metadata = await adapter.checkMetadata(
        expected,
        buildInfo.shellVersion,
        selected.releaseTag
      );
      const currentVersion = await adapter.getCurrentVersion();
      this.assertNotStopping();
      if (compareVersions(metadata.version, currentVersion) <= 0) return;
      this.assertSourceMatchesRuntime(expected, metadata, target);
      if (target === "linux-x64" && metadata.version !== this.deps.currentSharedWebVersion()) {
        return;
      }
      this.busyPhase = "downloading";
      const controller = new AbortController();
      this.controllers.set(metadata.componentId, controller);
      try {
        await adapter.downloadAndStage(metadata, {
          signal: controller.signal,
          onProgress: () => {},
          explicitRetry: false,
        });
      } finally {
        this.controllers.delete(metadata.componentId);
      }
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
    this.runtimeAdapters.clear();
    this.runtimeMetadata.clear();
    if (this.state.status !== "ready" && this.state.status !== "restarting") {
      this.state = this.createBaseState();
    } else {
      this.state = { ...this.state, runtimeContext };
    }
    return this.publish();
  }

  async reconcileOnStartup(actual: StartupComponentVersions): Promise<ProductUpdateState> {
    const ownsUpdates = await this.ensureUpdateOwnership(false);
    const journal = await this.deps.journal.read();
    this.startupReconciled = true;
    if (!journal) {
      this.journalPlanId = null;
      if (ownsUpdates) {
        this.state = this.createBaseState();
      } else {
        this.restoreReadOnlyWithoutJournal();
      }
      return this.publish();
    }
    this.journalPlanId = journal.planId;
    if (!ownsUpdates) {
      this.restoreReadOnlyJournal(journal);
      return this.publish();
    }
    if (journal.environmentId !== this.runtimeEnvironmentId) {
      this.restoreForeignEnvironmentJournal(journal);
      return this.publish();
    }
    this.restoreJournal(journal, false);
    const components = this.state.components.map((component) => {
      const actualVersion = this.actualVersionForComponent(component.id, actual);
      const installed = actualVersion === component.targetVersion;
      return installed
        ? {
            ...component,
            currentVersion: actualVersion,
            currentPublishedAt: component.targetPublishedAt,
            status: "succeeded" as const,
            downloaded: true,
            verified: true,
          }
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
      if (components.some((component) => component.id === "shell")) {
        this.deps.shell.disarmInstallOnQuit();
      }
      await this.clearJournal();
      return this.publish();
    }
    const missingPendingRuntime = components.find(
      (component) =>
        component.kind === "runtime" &&
        component.status !== "succeeded" &&
        component.verified &&
        component.targetVersion !== this.pendingVersionForComponent(component.id, actual)
    );
    if (!journal.restartIntent && missingPendingRuntime) {
      const summary = "The staged Desktop Runtime is no longer available";
      this.state = {
        ...this.state,
        status: "failed",
        updatedAt: this.timestamp(),
        components: components.map((component) =>
          component.id === missingPendingRuntime.id
            ? {
                ...component,
                status: "failed",
                progressPercent: null,
                downloaded: false,
                verified: false,
                errorSummary: summary,
              }
            : component
        ),
        restartRequired: false,
        errorSummary: summary,
        diagnostics: {
          ...this.state.diagnostics,
          failedComponentId: missingPendingRuntime.id,
          failedPhase: "verifying",
          recoveryAction: "Check for updates again to download the Runtime update.",
        },
      };
      this.restartIntent = false;
      await this.persistPlan();
      return this.publish();
    }
    if (!journal.restartIntent && components.every((component) => component.verified)) {
      this.state = {
        ...this.state,
        status: "ready",
        updatedAt: this.timestamp(),
        components,
        restartRequired: true,
        errorSummary: null,
      };
      await this.persistPlan();
      return this.publish();
    }
    const shell = components.find((component) => component.id === "shell");
    const runtime = components.find((component) => component.kind === "runtime");
    if (
      journal.restartIntent &&
      shell &&
      shell.status !== "succeeded" &&
      (!runtime ||
        runtime.status === "succeeded" ||
        runtime.targetVersion === this.pendingVersionForComponent(runtime.id, actual))
    ) {
      const shellFailureSummary = "Desktop Shell installation did not reach the planned version";
      this.state = {
        ...this.state,
        status: "failed",
        components: components.map((component) =>
          component.id === "shell"
            ? { ...component, status: "failed", errorSummary: shellFailureSummary }
            : component
        ),
        errorSummary: shellFailureSummary,
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
    if (journal.restartIntent) {
      const failed =
        missingPendingRuntime ?? components.find((component) => component.status !== "succeeded");
      const failedRuntime = failed?.kind === "runtime";
      const summary = failedRuntime
        ? "Desktop Runtime activation did not reach the planned version"
        : "The previous Desktop update did not complete";
      this.state = {
        ...this.state,
        status: "failed",
        updatedAt: this.timestamp(),
        components: components.map((component) =>
          component.status === "succeeded"
            ? component
            : {
                ...component,
                status: "failed",
                downloaded: failedRuntime ? false : component.downloaded,
                verified: failedRuntime ? false : component.verified,
                progressPercent: failedRuntime ? null : component.progressPercent,
                errorSummary: component.id === failed?.id ? summary : component.errorSummary,
              }
        ),
        restartRequired: false,
        errorSummary: summary,
        diagnostics: {
          ...this.state.diagnostics,
          failedComponentId: failed?.id ?? null,
          failedPhase: failedRuntime ? "activating" : "installing",
          recoveryAction: failedRuntime
            ? "Check for updates again to download the Runtime update."
            : this.state.diagnostics.recoveryAction,
        },
      };
      this.restartIntent = false;
      if (components.some((component) => component.id === "shell")) {
        this.deps.shell.disarmInstallOnQuit();
      }
      await this.persistPlan();
      return this.publish();
    }
    const failed =
      components.find((component) => !component.verified) ??
      components.find((component) => component.status !== "succeeded");
    const summary = "The previous Desktop update did not complete";
    this.state = {
      ...this.state,
      components: components.map((component) =>
        component.id === failed?.id
          ? { ...component, status: "failed", errorSummary: summary }
          : component
      ),
      status: "failed",
      updatedAt: this.timestamp(),
      restartRequired: false,
      errorSummary: summary,
      diagnostics: {
        ...this.state.diagnostics,
        failedComponentId: failed?.id ?? null,
        failedPhase: journal.status === "downloading" ? "downloading" : "recovering",
      },
    };
    this.restartIntent = false;
    if (components.some((component) => component.id === "shell")) {
      this.deps.shell.disarmInstallOnQuit();
    }
    await this.persistPlan();
    return this.publish();
  }

  private downloadComponents(explicitRetry: boolean): Promise<ProductUpdateState> {
    return this.trackActiveOperation(this.downloadComponentsInternal(explicitRetry));
  }

  private async downloadComponentsInternal(explicitRetry: boolean): Promise<ProductUpdateState> {
    this.assertUpdateOwnership();
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
    if (
      selected.some((component) => {
        if (component.kind !== "runtime") return false;
        const target = targetFromComponent(component.id);
        return !target || !this.runtimeAdapters.has(target) || !this.runtimeMetadata.has(target);
      })
    ) {
      throw updateError("update_plan_invalid", "The Runtime update adapter is unavailable");
    }
    const availableState = this.state;
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
    try {
      await this.persistPlan();
      this.assertNotStopping();
    } catch (error) {
      this.state = availableState;
      this.busyPhase = null;
      this.publish();
      throw error;
    }

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
          const target = targetFromComponent(component.id);
          const metadata = target ? this.runtimeMetadata.get(target) : null;
          const adapter = target ? this.runtimeAdapters.get(target) : null;
          if (!metadata || !adapter) {
            throw new Error("Runtime update metadata is unavailable");
          }
          await adapter.downloadAndStage(metadata, {
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
        await this.persistPlan();
      } catch (error) {
        if (this.cancelRequested) return;
        const summary = error instanceof Error ? error.message : String(error);
        this.updateComponent(component.id, {
          status: "failed",
          progressPercent: null,
          errorSummary: summary,
        });
        await this.persistPlan();
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
    productChannel: ProductRelease | null,
    buildInfo: DesktopBuildInfo,
    shellMetadata: ShellUpdateMetadata | null,
    checkedRuntimes: CheckedRuntime[]
  ): ProductUpdateComponent[] {
    const components: ProductUpdateComponent[] = [];
    if (shellMetadata?.updateNeeded) {
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
    if (!productChannel) return components;
    for (const checked of checkedRuntimes) {
      const metadata = checked.metadata;
      if (!metadata) continue;
      const currentVersion = this.currentVersionForTarget(checked.target);
      if (compareVersions(metadata.version, currentVersion) <= 0) continue;
      const runtimeEntry = productChannel.runtimes[checked.target];
      components.push({
        id: metadata.componentId,
        kind: "runtime",
        target: checked.target,
        currentVersion,
        currentPublishedAt:
          checked.target === this.runtimeTarget ? this.deps.currentProductPublishedAt() : null,
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
    productChannel: ProductRelease | null,
    desktopChannel: DesktopChannel | null,
    buildInfo: DesktopBuildInfo,
    components: ProductUpdateComponent[],
    checkedRuntimes: CheckedRuntime[]
  ): ProductUpdateState["compatibility"] {
    const shellIncluded = components.some((component) => component.id === "shell");
    const host = shellIncluded ? desktopChannel?.shell : buildInfo;
    const effectiveShellVersion = shellIncluded
      ? (desktopChannel?.shell.version ?? buildInfo.shellVersion)
      : buildInfo.shellVersion;
    if (!host) {
      return {
        compatible: false,
        code: "runtime_host_incompatible",
        summary: "The selected Runtime is incompatible with the planned Desktop Shell",
      };
    }
    for (const checked of checkedRuntimes) {
      const runtimeIncluded = components.some(
        (component) => component.kind === "runtime" && component.target === checked.target
      );
      const manifest = runtimeIncluded ? checked.metadata?.manifest : checked.currentManifest;
      const capabilityPairs: Array<[unknown, unknown]> = manifest
        ? [
            [manifest.requiredEngineVersion, host.engineVersion],
            [manifest.requiredNodeVersion, host.nodeVersion],
            [manifest.runtimeHostApiVersion, host.runtimeHostApiVersion],
            [manifest.apiProtocolVersion, host.apiProtocolVersion],
            [manifest.dataSchemaVersion, host.dataSchemaVersion],
          ]
        : [];
      if (runtimeIncluded && productChannel) {
        capabilityPairs.push(
          [productChannel.requirements.engineVersion, host.engineVersion],
          [productChannel.requirements.nodeVersion, host.nodeVersion],
          [productChannel.requirements.runtimeHostApiVersion, host.runtimeHostApiVersion],
          [productChannel.requirements.apiProtocolVersion, host.apiProtocolVersion],
          [productChannel.requirements.dataSchemaVersion, host.dataSchemaVersion]
        );
      }
      const target = manifest ? `${manifest.platform}-${manifest.arch}` : null;
      if (
        !manifest ||
        target !== checked.target ||
        capabilityPairs.some(([required, actual]) => required !== actual) ||
        compareVersions(effectiveShellVersion, manifest.minShellVersion) < 0 ||
        (runtimeIncluded &&
          productChannel !== null &&
          compareVersions(effectiveShellVersion, productChannel.minShellVersion) < 0)
      ) {
        const shellBreaksInstalledRuntime = shellIncluded && !runtimeIncluded;
        return {
          compatible: false,
          code: shellBreaksInstalledRuntime
            ? "shell_breaks_current_runtime"
            : "runtime_host_incompatible",
          summary: shellBreaksInstalledRuntime
            ? "The target Desktop Shell cannot safely carry the current Runtime"
            : "The selected Runtime is incompatible with the planned Desktop Shell",
        };
      }
    }
    if (this.runtimeTarget === "linux-x64") {
      const effectiveWebVersion = this.effectiveRuntimeVersion("win32-x64", components);
      const effectiveRuntimeVersion = this.effectiveRuntimeVersion("linux-x64", components);
      if (effectiveRuntimeVersion !== effectiveWebVersion) {
        return {
          compatible: false,
          code: "shared_web_update_required",
          summary: `WSL Runtime ${effectiveRuntimeVersion} requires shared Web ${effectiveRuntimeVersion}, but this restart would use shared Web ${effectiveWebVersion}`,
        };
      }
    }
    return { compatible: true, code: null, summary: null };
  }

  private productCompatibilityHost(
    source: DesktopBuildInfo | DesktopChannel["shell"]
  ): ProductCompatibilityHost {
    const shellVersion = "shellVersion" in source ? source.shellVersion : source.version;
    if (
      !source.engineVersion ||
      !source.nodeVersion ||
      !source.runtimeHostApiVersion ||
      !source.apiProtocolVersion ||
      !source.dataSchemaVersion
    ) {
      throw new Error(`Desktop Shell ${shellVersion} has incomplete Runtime capabilities`);
    }
    return {
      shellVersion,
      engineVersion: source.engineVersion,
      nodeVersion: source.nodeVersion,
      runtimeHostApiVersion: source.runtimeHostApiVersion,
      apiProtocolVersion: source.apiProtocolVersion,
      dataSchemaVersion: source.dataSchemaVersion,
    };
  }

  private assertSourceMatchesShell(channel: DesktopChannel, shell: ShellUpdateMetadata): void {
    if (
      shell.version !== channel.shell.version ||
      shell.publishedAt !== channel.shell.publishedAt
    ) {
      throw new Error("Desktop Shell source does not match signed Desktop channel");
    }
  }

  private assertSourceMatchesRuntime(
    expected: ProductChannelRuntime,
    runtime: RuntimeUpdateMetadata,
    target: RuntimeTarget
  ): void {
    if (
      runtime.componentId !== `runtime:${target}` ||
      runtime.version !== expected.version ||
      runtime.publishedAt !== expected.publishedAt
    ) {
      throw new Error("Runtime source does not match signed Product channel");
    }
  }

  private runtimeTargetsForCheck(): RuntimeTarget[] {
    return this.runtimeTarget === "linux-x64" ? ["win32-x64", "linux-x64"] : ["win32-x64"];
  }

  private environmentIdForTarget(target: RuntimeTarget): string {
    return target === this.runtimeTarget ? this.runtimeEnvironmentId : "native";
  }

  private currentVersionForTarget(target: RuntimeTarget): string {
    return target === "win32-x64" && this.runtimeTarget === "linux-x64"
      ? this.deps.currentSharedWebVersion()
      : this.deps.currentProductVersion();
  }

  private effectiveRuntimeVersion(
    target: RuntimeTarget,
    components: ProductUpdateComponent[]
  ): string {
    return (
      components.find((component) => component.kind === "runtime" && component.target === target)
        ?.targetVersion ?? this.currentVersionForTarget(target)
    );
  }

  private actualVersionForComponent(
    id: UpdateComponentId,
    actual: StartupComponentVersions
  ): string {
    if (id === "shell") return actual.shellVersion;
    if (id === "runtime:win32-x64" && this.runtimeTarget === "linux-x64") {
      return actual.sharedWebVersion ?? this.deps.currentSharedWebVersion();
    }
    return actual.runtimeVersion;
  }

  private pendingVersionForComponent(
    id: UpdateComponentId,
    actual: StartupComponentVersions
  ): string | null {
    if (id === "runtime:win32-x64" && this.runtimeTarget === "linux-x64") {
      return actual.pendingSharedWebVersion ?? null;
    }
    return actual.pendingRuntimeVersion;
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
      productChannelError: null,
      desktopChannelError: null,
      shellVersion: buildInfo.shellVersion,
      shellPublishedAt: buildInfo.publishedAt,
      shellBuiltAt: buildInfo.builtAt,
      engineVersion: buildInfo.engineVersion,
      nodeVersion: buildInfo.nodeVersion,
      runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
      apiProtocolVersion: buildInfo.apiProtocolVersion,
      dataSchemaVersion: buildInfo.dataSchemaVersion,
      logLocations: [...new Set([...shell.logLocations, this.deps.journalLocation])],
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
    const record: DesktopUpdateJournalRecord = {
      schemaVersion: 1,
      planId: this.state.planId,
      status,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt ?? this.timestamp(),
      runtimeTarget: this.runtimeTarget,
      environmentId: this.runtimeEnvironmentId,
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
    };
    const pending = this.journalWriteQueue.then(async () => {
      await this.deps.journal.write(record, {
        expectedPlanId: this.journalPlanId,
        ownerId: this.deps.updateOwnerId,
      });
      this.journalPlanId = record.planId;
    });
    this.journalWriteQueue = pending.catch(() => {});
    await pending;
  }

  private async clearJournal(): Promise<void> {
    const pending = this.journalWriteQueue.then(async () => {
      await this.deps.journal.clear({
        expectedPlanId: this.journalPlanId,
        ownerId: this.deps.updateOwnerId,
      });
      this.journalPlanId = null;
    });
    this.journalWriteQueue = pending.catch(() => {});
    await pending;
  }

  private restoreJournal(journal: DesktopUpdateJournalRecord, armRestart = true): void {
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
    if (
      armRestart &&
      journal.restartIntent &&
      journal.components.every((component) => component.verified)
    ) {
      if (journal.components.some((component) => component.id === "shell")) {
        this.deps.shell.armInstallOnQuit();
      }
    }
  }

  private restoreForeignEnvironmentJournal(journal: DesktopUpdateJournalRecord): void {
    const activeRuntimeTarget = this.runtimeTarget;
    this.restoreJournal(journal, false);
    this.runtimeTarget = activeRuntimeTarget;
    this.restartIntent = false;
    if (journal.components.some((component) => component.id === "shell")) {
      this.deps.shell.disarmInstallOnQuit();
    }
    const summary = `The previous Desktop update targeted unavailable environment ${journal.environmentId}`;
    const failed = this.state.components.find((component) => component.kind === "runtime");
    this.state = {
      ...this.state,
      status: "failed",
      updatedAt: this.timestamp(),
      components: this.state.components.map((component) => ({
        ...component,
        status: "failed",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: summary,
      })),
      restartRequired: false,
      errorSummary: summary,
      diagnostics: {
        ...this.state.diagnostics,
        failedComponentId: failed?.id ?? this.state.components[0]?.id ?? null,
        failedPhase: "recovering",
        recoveryAction: "Check for updates again to replace the unavailable environment plan.",
      },
    };
  }

  private restoreReadOnlyJournal(journal: DesktopUpdateJournalRecord): void {
    const activeRuntimeTarget = this.runtimeTarget;
    this.restoreJournal(journal, false);
    this.runtimeTarget = activeRuntimeTarget;
    this.restartIntent = false;
    if (journal.components.some((component) => component.id === "shell")) {
      this.deps.shell.disarmInstallOnQuit();
    }
    const summary = `Desktop updates are currently controlled by environment ${journal.environmentId} in another Desktop window`;
    const failed = this.state.components.find((component) => component.kind === "runtime");
    this.state = {
      ...this.state,
      status: "failed",
      components: this.state.components.map((component) => ({
        ...component,
        status: "failed",
        progressPercent: null,
        errorSummary: summary,
      })),
      restartRequired: false,
      errorSummary: summary,
      diagnostics: {
        ...this.state.diagnostics,
        failedComponentId: failed?.id ?? this.state.components[0]?.id ?? null,
        failedPhase: "recovering",
        recoveryAction: "Finish or close the update-owning Desktop window, then check again.",
      },
    };
  }

  private restoreReadOnlyWithoutJournal(): void {
    const summary = "Desktop updates are currently controlled by another Desktop window";
    this.state = {
      ...this.createBaseState(),
      status: "failed",
      errorSummary: summary,
      diagnostics: {
        ...this.createDiagnostics(this.deps.getBuildInfo()),
        failedPhase: "recovering",
        recoveryAction: "Finish or close the update-owning Desktop window, then check again.",
      },
    };
  }

  private async ensureUpdateOwnership(manual: boolean): Promise<boolean> {
    if (this.stopping) {
      if (manual) {
        throw updateError("desktop_update_owner_unavailable", "Coder Studio is shutting down");
      }
      return false;
    }
    if (this.deps.journal.isOwner(this.deps.updateOwnerId)) return true;
    if (await this.deps.journal.acquireOwner(this.deps.updateOwnerId)) {
      this.journalPlanId = (await this.deps.journal.read())?.planId ?? null;
      return true;
    }
    if (manual) {
      throw updateError(
        "desktop_update_owner_unavailable",
        "Desktop updates are currently controlled by another Desktop window"
      );
    }
    return false;
  }

  private assertUpdateOwnership(): void {
    this.assertNotStopping();
    if (!this.deps.journal.isOwner(this.deps.updateOwnerId)) {
      throw updateError(
        "desktop_update_owner_unavailable",
        "Desktop updates are currently controlled by another Desktop window"
      );
    }
  }

  private assertNotStopping(): void {
    if (this.stopping) {
      throw updateError("desktop_update_owner_unavailable", "Coder Studio is shutting down");
    }
  }

  private trackActiveOperation<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation);
    void operation.then(
      () => this.activeOperations.delete(operation),
      () => this.activeOperations.delete(operation)
    );
    return operation;
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
