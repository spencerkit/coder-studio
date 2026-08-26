import type {
  DesktopPreferencesPatch,
  DesktopPreferencesSnapshot,
  DesktopUpdateSettings,
  ProductUpdateState,
} from "@coder-studio/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  DesktopBackendStatus,
  DesktopEnvironmentOpenResult,
  DesktopEnvironmentProgress,
  DesktopEnvironmentSummary,
  DesktopNotificationRequest,
  DesktopNotificationResult,
  DesktopNotificationTarget,
  DesktopRuntimeUpdateState,
  DesktopWindowActivityState,
} from "./protocol.js";

const notificationClickListeners = new Set<(target: DesktopNotificationTarget) => void>();
let pendingNotificationClick: DesktopNotificationTarget | null = null;

ipcRenderer.on(
  "desktop:notification-clicked",
  (_event: Electron.IpcRendererEvent, target: DesktopNotificationTarget) => {
    if (notificationClickListeners.size === 0) {
      pendingNotificationClick = target;
      return;
    }
    for (const listener of notificationClickListeners) listener(target);
  }
);

const api: DesktopApi = {
  platform: process.platform,
  desktopPreferencesApiVersion: 1,
  updateApiVersion: 1,
  getAppVersion: () => ipcRenderer.invoke("desktop:get-app-version") as Promise<string>,
  selectWorkspaceDirectory: () => ipcRenderer.invoke("desktop:select-workspace-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  getBackendStatus: () =>
    ipcRenderer.invoke("desktop:get-backend-status") as Promise<DesktopBackendStatus | null>,
  recoverAuthentication: () =>
    ipcRenderer.invoke("desktop:recover-authentication") as Promise<boolean>,
  onAuthenticationRecovered: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("desktop:authentication-recovered", handler);
    return () => ipcRenderer.removeListener("desktop:authentication-recovered", handler);
  },
  getWindowActivityState: () =>
    ipcRenderer.invoke("desktop:get-window-activity-state") as Promise<DesktopWindowActivityState>,
  onWindowActivityStateChanged: (listener: (state: DesktopWindowActivityState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopWindowActivityState) =>
      listener(state);
    ipcRenderer.on("desktop:window-activity-state-changed", handler);
    return () => ipcRenderer.removeListener("desktop:window-activity-state-changed", handler);
  },
  getNotificationSupport: () =>
    ipcRenderer.invoke("desktop:get-notification-support") as Promise<boolean>,
  showNotification: (request: DesktopNotificationRequest) =>
    ipcRenderer.invoke("desktop:show-notification", request) as Promise<DesktopNotificationResult>,
  onNotificationClicked: (listener: (target: DesktopNotificationTarget) => void) => {
    notificationClickListeners.add(listener);
    if (pendingNotificationClick) {
      const target = pendingNotificationClick;
      pendingNotificationClick = null;
      listener(target);
    }
    return () => notificationClickListeners.delete(listener);
  },
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
  getDesktopPreferences: () =>
    ipcRenderer.invoke("desktop:get-preferences") as Promise<DesktopPreferencesSnapshot>,
  initializeDesktopTheme: (themeId: string) =>
    ipcRenderer.invoke(
      "desktop:initialize-theme-preference",
      themeId
    ) as Promise<DesktopPreferencesSnapshot>,
  updateDesktopPreferences: (patch: DesktopPreferencesPatch) =>
    ipcRenderer.invoke("desktop:update-preferences", patch) as Promise<DesktopPreferencesSnapshot>,
  onDesktopPreferencesChanged: (listener: (snapshot: DesktopPreferencesSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopPreferencesSnapshot) =>
      listener(snapshot);
    ipcRenderer.on("desktop:preferences-changed", handler);
    return () => ipcRenderer.removeListener("desktop:preferences-changed", handler);
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
