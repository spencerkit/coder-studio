import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopAppController } from "./app-controller.js";
import { createDesktopAppController } from "./desktop-startup.js";
import { registerShellUpdateIpc } from "./shell-update-ipc.js";
import { ShellUpdateService } from "./shell-update-service.js";

let controller: DesktopAppController | null = null;
let quitting = false;
let shellUpdateInstallInProgress = false;

async function bootstrap(): Promise<void> {
  const shellUpdateService = new ShellUpdateService({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    updater: autoUpdater,
  });

  registerShellUpdateIpc({
    ipcMain,
    getWindows: () => BrowserWindow.getAllWindows(),
    shellUpdateService,
    beforeRestartToApply: async () => {
      await controller?.shutdown();
      shellUpdateInstallInProgress = true;
      quitting = true;
    },
  });

  controller = await createDesktopAppController({
    app: {
      isPackaged: app.isPackaged,
      getAppPath: () => app.getAppPath(),
      getPath: (name) => app.getPath(name as Parameters<typeof app.getPath>[0]),
      getVersion: () => app.getVersion(),
    },
    importMetaUrl: import.meta.url,
    resourcesPath: process.resourcesPath,
  });

  await controller.launch();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => controller?.focus());
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error("Desktop bootstrap failed:", error);
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shellUpdateInstallInProgress) {
      return;
    }
    if (quitting) {
      return;
    }

    quitting = true;
    event.preventDefault();
    void (controller?.shutdown() ?? Promise.resolve()).finally(() => app.exit(0));
  });

  ipcMain.on("desktop:retry-startup", () => {
    void controller?.retry();
  });

  ipcMain.on("desktop:quit", () => {
    app.quit();
  });
}
