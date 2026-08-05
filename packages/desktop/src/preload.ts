import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, DesktopBackendStatus } from "./protocol.js";

const api: DesktopApi = {
  platform: process.platform,
  selectWorkspaceDirectory: () => ipcRenderer.invoke("desktop:select-workspace-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  getBackendStatus: () =>
    ipcRenderer.invoke("desktop:get-backend-status") as Promise<DesktopBackendStatus | null>,
};

contextBridge.exposeInMainWorld("coderStudioDesktop", Object.freeze(api));
