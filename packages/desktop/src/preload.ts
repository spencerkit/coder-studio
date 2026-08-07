import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  DesktopBackendStatus,
  DesktopEnvironmentOpenResult,
  DesktopEnvironmentProgress,
  DesktopEnvironmentSummary,
} from "./protocol.js";

const api: DesktopApi = {
  platform: process.platform,
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
};

contextBridge.exposeInMainWorld("coderStudioDesktop", Object.freeze(api));
