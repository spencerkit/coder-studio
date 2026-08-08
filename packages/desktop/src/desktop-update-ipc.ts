import {
  createDefaultDesktopUpdateSettings,
  type DesktopUpdateSettings,
  type ProductUpdateState,
} from "@coder-studio/core";
import type { DesktopRuntimeUpdateState } from "./protocol.js";

interface DesktopUpdateCoordinatorPort {
  getState(): ProductUpdateState;
  check(options: { manual: boolean }): Promise<ProductUpdateState>;
  download(): Promise<ProductUpdateState>;
  retryFailed(): Promise<ProductUpdateState>;
  cancelDownload(): ProductUpdateState;
  prepareRestart(): Promise<ProductUpdateState>;
  restartAndInstall(): Promise<boolean>;
  getSettings(): Promise<DesktopUpdateSettings>;
  setSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings>;
}

interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export interface RegisterDesktopUpdateIpcOptions {
  ipc: IpcRegistrar;
  getCoordinator: () => DesktopUpdateCoordinatorPort | null;
  getFallbackState: () => ProductUpdateState;
}

export function toLegacyRuntimeUpdateState(state: ProductUpdateState): DesktopRuntimeUpdateState {
  const runtime = state.components.find((component) => component.kind === "runtime");
  const status: DesktopRuntimeUpdateState["status"] =
    state.status === "unsupported"
      ? "disabled"
      : state.status === "checking"
        ? "checking"
        : state.status === "ready" || state.status === "restarting"
          ? "ready"
          : state.status === "failed"
            ? runtime?.errorSummary?.includes("quarantined")
              ? "quarantined"
              : "error"
            : state.status === "idle" || state.status === "succeeded"
              ? "current"
              : "idle";
  return {
    supported: state.runtimeContext.supported,
    currentVersion: runtime?.currentVersion ?? state.productVersion,
    latestVersion: runtime?.targetVersion ?? null,
    pendingVersion: runtime?.verified ? runtime.targetVersion : null,
    lastCheckedAt: state.lastCheckedAt,
    status,
    errorSummary: state.errorSummary,
    unsupportedReason: state.runtimeContext.unsupportedReason,
  };
}

export function registerDesktopUpdateIpc(options: RegisterDesktopUpdateIpcOptions): void {
  const getState = () => options.getCoordinator()?.getState() ?? options.getFallbackState();
  options.ipc.handle("desktop:get-update-state", getState);
  options.ipc.handle(
    "desktop:check-for-updates",
    () => options.getCoordinator()?.check({ manual: true }) ?? getState()
  );
  options.ipc.handle(
    "desktop:download-update",
    () => options.getCoordinator()?.download() ?? getState()
  );
  options.ipc.handle(
    "desktop:retry-update",
    () => options.getCoordinator()?.retryFailed() ?? getState()
  );
  options.ipc.handle(
    "desktop:cancel-update-download",
    () => options.getCoordinator()?.cancelDownload() ?? getState()
  );
  options.ipc.handle(
    "desktop:prepare-update-restart",
    () => options.getCoordinator()?.prepareRestart() ?? getState()
  );
  options.ipc.handle(
    "desktop:restart-and-install-update",
    () => options.getCoordinator()?.restartAndInstall() ?? false
  );
  options.ipc.handle(
    "desktop:get-update-settings",
    () => options.getCoordinator()?.getSettings() ?? createDefaultDesktopUpdateSettings()
  );
  options.ipc.handle("desktop:set-update-settings", (_event, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid Desktop update settings");
    return (
      options
        .getCoordinator()
        ?.setSettings(
          patch as Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
        ) ?? createDefaultDesktopUpdateSettings()
    );
  });

  options.ipc.handle("desktop:get-runtime-update-state", () =>
    toLegacyRuntimeUpdateState(getState())
  );
  options.ipc.handle("desktop:check-runtime-update", async () => {
    const state = options.getCoordinator()
      ? await options.getCoordinator()?.check({ manual: true })
      : getState();
    return toLegacyRuntimeUpdateState(state as ProductUpdateState);
  });
  options.ipc.handle("desktop:restart-for-runtime-update", async () => {
    const coordinator = options.getCoordinator();
    if (!coordinator) return false;
    await coordinator.prepareRestart();
    return coordinator.restartAndInstall();
  });
}
