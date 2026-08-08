import type { DesktopUpdateSettings, ProductUpdateState } from "@coder-studio/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  DesktopBackendStatus,
  DesktopEnvironmentOpenResult,
  DesktopEnvironmentProgress,
  DesktopEnvironmentSummary,
  DesktopRuntimeUpdateState,
} from "./protocol.js";

const api: DesktopApi = {
  platform: process.platform,
  updateApiVersion: 1,
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version") as Promise<string>,
  selectWorkspaceDirectory: () => ipcRenderer.invoke("desktop:select-workspace-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  getBackendStatus: () =>
    ipcRenderer.invoke("desktop:get-backend-status") as Promise<DesktopBackendStatus | null>,
  listEnvironments: () =>
    ipcRenderer.invoke("desktop:list-environments") as Promise<DesktopEnvironmentSummary[]>,
  getActiveEnvironment: () =>
    ipcRenderer.invoke("desktop:get-active-environment") as Promise<DesktopEnvironmentSummary>,
  openEnvironment: (environmentId: string) =>
    ipcRenderer.invoke(
      "desktop:open-environment",
      environmentId
    ) as Promise<DesktopEnvironmentOpenResult>,
  onEnvironmentProgress: (listener: (event: DesktopEnvironmentProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DesktopEnvironmentProgress) =>
      listener(progress);
    ipcRenderer.on("desktop:environment-progress", handler);
    return () => ipcRenderer.removeListener("desktop:environment-progress", handler);
  },
  getUpdateState: () =>
    ipcRenderer.invoke("desktop:get-update-state") as Promise<ProductUpdateState>,
  checkForUpdates: () =>
    ipcRenderer.invoke("desktop:check-for-updates") as Promise<ProductUpdateState>,
  downloadUpdate: () =>
    ipcRenderer.invoke("desktop:download-update") as Promise<ProductUpdateState>,
  retryUpdate: () => ipcRenderer.invoke("desktop:retry-update") as Promise<ProductUpdateState>,
  cancelUpdateDownload: () =>
    ipcRenderer.invoke("desktop:cancel-update-download") as Promise<ProductUpdateState>,
  prepareUpdateRestart: () =>
    ipcRenderer.invoke("desktop:prepare-update-restart") as Promise<ProductUpdateState>,
  restartAndInstallUpdate: () =>
    ipcRenderer.invoke("desktop:restart-and-install-update") as Promise<boolean>,
  getUpdateSettings: () =>
    ipcRenderer.invoke("desktop:get-update-settings") as Promise<DesktopUpdateSettings>,
  setUpdateSettings: (
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ) => ipcRenderer.invoke("desktop:set-update-settings", patch) as Promise<DesktopUpdateSettings>,
  onUpdateStateChanged: (listener: (state: ProductUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ProductUpdateState) =>
      listener(state);
    ipcRenderer.on("desktop:update-state-changed", handler);
    return () => ipcRenderer.removeListener("desktop:update-state-changed", handler);
  },
  getRuntimeUpdateState: () =>
    ipcRenderer.invoke("desktop:get-runtime-update-state") as Promise<DesktopRuntimeUpdateState>,
  checkRuntimeUpdate: () =>
    ipcRenderer.invoke("desktop:check-runtime-update") as Promise<DesktopRuntimeUpdateState>,
  restartForRuntimeUpdate: () =>
    ipcRenderer.invoke("desktop:restart-for-runtime-update") as Promise<boolean>,
  onRuntimeUpdateStateChanged: (listener: (state: DesktopRuntimeUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopRuntimeUpdateState) =>
      listener(state);
    ipcRenderer.on("desktop:runtime-update-state-changed", handler);
    return () => ipcRenderer.removeListener("desktop:runtime-update-state-changed", handler);
  },
};

contextBridge.exposeInMainWorld("coderStudioDesktop", Object.freeze(api));
