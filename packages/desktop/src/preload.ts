import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("coderStudioDesktop", {
  retryStartup: () => ipcRenderer.send("desktop:retry-startup"),
  quit: () => ipcRenderer.send("desktop:quit"),
});
