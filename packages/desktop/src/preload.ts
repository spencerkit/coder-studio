import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("coderStudioDesktop", {
  retryStartup: () => ipcRenderer.send("desktop:retry-startup"),
  quit: () => ipcRenderer.send("desktop:quit"),
  shellUpdate: {
    getState: () => ipcRenderer.invoke("desktop:shell-update:get-state"),
    check: () => ipcRenderer.invoke("desktop:shell-update:check"),
    install: () => ipcRenderer.invoke("desktop:shell-update:install"),
    restartToApply: () => ipcRenderer.invoke("desktop:shell-update:restart-to-apply"),
    subscribe: (listener: (state: unknown) => void) => {
      const wrapped = (_event: unknown, state: unknown) => {
        listener(state);
      };
      ipcRenderer.on("desktop:shell-update:state-changed", wrapped);
      return () => {
        ipcRenderer.removeListener("desktop:shell-update:state-changed", wrapped);
      };
    },
  },
});
