import type {
  DesktopUpdateSettings,
  ProductUpdatePreparation,
  ProductUpdateState,
  ProductUpdateStatus,
  UpdatePrepareInstallResponse,
  UpdateStateView,
} from "@coder-studio/core";
import { createDefaultProductUpdateState } from "@coder-studio/core";
import type {
  CreateUpdateControllerInput,
  DesktopUpdateBridge,
  UpdateCommandDispatcher,
  UpdateController,
  UpdateControllerKind,
} from "./types";

function actionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function dispatchData<T>(
  dispatch: UpdateCommandDispatcher,
  operation: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await dispatch<T>(operation, args, undefined);
  if (!result.ok || result.data === undefined) {
    throw actionError(
      result.error?.code ?? "update_command_failed",
      result.error?.message ?? `${operation} failed`
    );
  }
  return result.data;
}

function normalizeCliStatus(state: UpdateStateView): ProductUpdateStatus {
  if (state.updateStatus === "installing") return "downloading";
  if (state.updateStatus === "restarting") return "restarting";
  if (state.updateStatus === "succeeded") return "succeeded";
  if (state.updateStatus === "failed") return "failed";
  if (state.updateStatus === "manual_required") return "manual_required";
  if (state.updateStatus === "checking") return "checking";
  if (state.availability === "update_available") return "available";
  return state.supported ? "idle" : "unsupported";
}

export function mapCliUpdateState(state: UpdateStateView): ProductUpdateState {
  const status = normalizeCliStatus(state);
  const targetVersion = state.targetVersion ?? state.latestVersion;
  return {
    schemaVersion: 1,
    runtimeContext: state.runtimeContext,
    status,
    productVersion: state.currentVersion,
    productPublishedAt: state.currentPublishedAt,
    planId: null,
    createdAt: null,
    updatedAt: null,
    lastCheckedAt: state.lastCheckedAt,
    components: [
      {
        id: "cli",
        kind: "cli",
        target: null,
        currentVersion: state.currentVersion,
        currentPublishedAt: state.currentPublishedAt,
        targetVersion,
        targetPublishedAt: state.latestPublishedAt,
        status,
        progressPercent: null,
        downloaded: state.updateStatus === "restarting" || state.updateStatus === "succeeded",
        verified: state.updateStatus === "succeeded",
        errorSummary: state.errorSummary,
      },
    ],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: state.errorSummary ? "cli" : null,
      failedPhase:
        state.updateStatus === "failed" || state.updateStatus === "manual_required"
          ? state.updateStatus
          : null,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: state.manualCommand,
    },
    restartRequired: state.updateStatus === "restarting",
    requiresManualStep: state.requiresManualStep,
    manualCommand: state.manualCommand,
    errorSummary: state.errorSummary,
  };
}

abstract class UpdateAdapterBase implements UpdateController {
  abstract readonly kind: UpdateControllerKind;
  protected state: ProductUpdateState;
  private readonly listeners = new Set<(state: ProductUpdateState) => void>();
  private disposed = false;

  constructor(initialState: ProductUpdateState) {
    this.state = initialState;
  }

  getState(): ProductUpdateState {
    return this.state;
  }

  subscribe(listener: (state: ProductUpdateState) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected applyState(state: ProductUpdateState): ProductUpdateState {
    if (this.disposed) return this.state;
    this.state = state;
    for (const listener of this.listeners) listener(state);
    return state;
  }

  protected markDisposed(): boolean {
    if (this.disposed) return false;
    this.disposed = true;
    this.listeners.clear();
    return true;
  }

  abstract refresh(): Promise<ProductUpdateState>;
  abstract check(): Promise<ProductUpdateState>;
  abstract download(): Promise<ProductUpdateState>;
  abstract retry(): Promise<ProductUpdateState>;
  abstract cancelDownload(): Promise<ProductUpdateState>;
  abstract prepare(): Promise<ProductUpdatePreparation>;
  abstract start(prepared: ProductUpdatePreparation, force: boolean): Promise<ProductUpdateState>;
  abstract getSettings(): Promise<DesktopUpdateSettings | null>;
  abstract setSettings(
    patch: Partial<Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">>
  ): Promise<DesktopUpdateSettings | null>;
  abstract dispose(): void;
}

class DesktopUpdateAdapter extends UpdateAdapterBase {
  readonly kind = "desktop" as const;
  private readonly unsubscribeBridge: () => void;

  constructor(
    private readonly bridge: DesktopUpdateBridge,
    private readonly dispatch: UpdateCommandDispatcher,
    initialState: ProductUpdateState
  ) {
    super(initialState);
    this.unsubscribeBridge = bridge.onUpdateStateChanged((state) => this.applyState(state));
  }

  async refresh(): Promise<ProductUpdateState> {
    return this.applyState(await this.bridge.getUpdateState());
  }

  async check(): Promise<ProductUpdateState> {
    return this.applyState(await this.bridge.checkForUpdates());
  }

  async download(): Promise<ProductUpdateState> {
    return this.applyState(await this.bridge.downloadUpdate());
  }

  async retry(): Promise<ProductUpdateState> {
    return this.applyState(await this.bridge.retryUpdate());
  }

  async cancelDownload(): Promise<ProductUpdateState> {
    return this.applyState(await this.bridge.cancelUpdateDownload());
  }

  async prepare(): Promise<ProductUpdatePreparation> {
    const response = await dispatchData<UpdatePrepareInstallResponse>(
      this.dispatch,
      "updates.prepareInstall",
      {}
    );
    return {
      state: this.state,
      activity: response.activity,
      canProceed: this.state.status === "ready",
    };
  }

  async start(_prepared: ProductUpdatePreparation, _force: boolean): Promise<ProductUpdateState> {
    const state = this.applyState(await this.bridge.prepareUpdateRestart());
    if (!(await this.bridge.restartAndInstallUpdate())) {
      throw actionError("update_restart_failed", "Desktop failed to begin the update restart");
    }
    return state;
  }

  getSettings(): Promise<DesktopUpdateSettings> {
    return this.bridge.getUpdateSettings();
  }

  async setSettings(
    patch: Partial<Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">>
  ): Promise<DesktopUpdateSettings> {
    const current = await this.bridge.getUpdateSettings();
    return this.bridge.setUpdateSettings({
      autoCheckEnabled: patch.autoCheckEnabled ?? current.autoCheckEnabled,
      checkIntervalSec: patch.checkIntervalSec ?? current.checkIntervalSec,
    });
  }

  dispose(): void {
    if (!this.markDisposed()) return;
    this.unsubscribeBridge();
  }
}

class CliUpdateAdapter extends UpdateAdapterBase {
  readonly kind = "cli" as const;

  constructor(
    private readonly dispatch: UpdateCommandDispatcher,
    initialState: UpdateStateView
  ) {
    super(mapCliUpdateState(initialState));
  }

  private async command(operation: string, args: Record<string, unknown> = {}) {
    const state = await dispatchData<UpdateStateView>(this.dispatch, operation, args);
    return this.applyState(mapCliUpdateState(state));
  }

  refresh(): Promise<ProductUpdateState> {
    return this.command("updates.getState");
  }

  check(): Promise<ProductUpdateState> {
    return this.command("updates.check");
  }

  download(): Promise<ProductUpdateState> {
    return Promise.reject(
      actionError("update_action_unavailable", "CLI updates install during restart")
    );
  }

  retry(): Promise<ProductUpdateState> {
    return Promise.reject(
      actionError("update_action_unavailable", "Retry the CLI update from its primary action")
    );
  }

  cancelDownload(): Promise<ProductUpdateState> {
    return Promise.reject(
      actionError("update_action_unavailable", "CLI update downloads cannot be cancelled")
    );
  }

  async prepare(): Promise<ProductUpdatePreparation> {
    const response = await dispatchData<UpdatePrepareInstallResponse>(
      this.dispatch,
      "updates.prepareInstall",
      {}
    );
    const state = this.applyState(mapCliUpdateState(response));
    return { state, activity: response.activity, canProceed: response.canStartInstall };
  }

  async start(prepared: ProductUpdatePreparation, force: boolean): Promise<ProductUpdateState> {
    const targetVersion = prepared.state.components.find(
      (component) => component.id === "cli"
    )?.targetVersion;
    if (!targetVersion) {
      throw actionError("update_target_missing", "CLI update target version is unavailable");
    }
    return this.command("updates.startInstall", { targetVersion, force });
  }

  getSettings(): Promise<null> {
    return Promise.resolve(null);
  }

  setSettings(): Promise<null> {
    return Promise.resolve(null);
  }

  dispose(): void {
    this.markDisposed();
  }
}

class ReadOnlyUpdateAdapter extends UpdateAdapterBase {
  readonly kind = "readonly" as const;
  private readonly error: Error & { code: string };

  constructor(serverState: UpdateStateView, reason: string) {
    const state = createDefaultProductUpdateState(
      { ...serverState.runtimeContext, supported: false, unsupportedReason: reason },
      serverState.currentVersion,
      serverState.currentPublishedAt
    );
    state.errorSummary = reason;
    super(state);
    this.error = actionError("update_read_only", reason);
  }

  refresh(): Promise<ProductUpdateState> {
    return Promise.resolve(this.state);
  }

  private reject(): Promise<never> {
    return Promise.reject(this.error);
  }

  check(): Promise<ProductUpdateState> {
    return this.reject();
  }
  download(): Promise<ProductUpdateState> {
    return this.reject();
  }
  retry(): Promise<ProductUpdateState> {
    return this.reject();
  }
  cancelDownload(): Promise<ProductUpdateState> {
    return this.reject();
  }
  prepare(): Promise<ProductUpdatePreparation> {
    return this.reject();
  }
  start(): Promise<ProductUpdateState> {
    return this.reject();
  }
  getSettings(): Promise<null> {
    return Promise.resolve(null);
  }
  setSettings(): Promise<null> {
    return Promise.resolve(null);
  }
  dispose(): void {
    this.markDisposed();
  }
}

export async function createUpdateController(
  input: CreateUpdateControllerInput
): Promise<UpdateController> {
  const context = input.serverState.runtimeContext;
  if (context.environment === "desktop-managed" && context.authority === "desktop") {
    if (!input.desktopBridge || input.desktopBridge.updateApiVersion !== 1) {
      return new ReadOnlyUpdateAdapter(
        input.serverState,
        "Open this update in Coder Studio Desktop"
      );
    }
    const desktopState = await input.desktopBridge.getUpdateState();
    const desktopContext = desktopState.runtimeContext;
    const validDesktopContext =
      desktopContext.authority === "desktop" &&
      desktopContext.supported &&
      (desktopContext.environment === "desktop-native" ||
        desktopContext.environment === "desktop-wsl");
    return validDesktopContext
      ? new DesktopUpdateAdapter(input.desktopBridge, input.dispatch, desktopState)
      : new ReadOnlyUpdateAdapter(input.serverState, "Desktop update context mismatch");
  }
  if (context.environment === "cli-global-npm" && context.authority === "cli") {
    return input.desktopBridge
      ? new ReadOnlyUpdateAdapter(input.serverState, "Desktop bridge and CLI context disagree")
      : new CliUpdateAdapter(input.dispatch, input.serverState);
  }
  return new ReadOnlyUpdateAdapter(
    input.serverState,
    context.unsupportedReason ?? "Updates are unavailable in this environment"
  );
}
