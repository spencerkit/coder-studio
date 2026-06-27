import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import { DesktopAppController, showDesktopErrorPage } from "./app-controller.js";
import { resolveDesktopLaunchConfig } from "./desktop-config.js";
import { createSidecarPaths, startDesktopSidecar } from "./sidecar-manager.js";
import { createMainWindow, loadDesktopUrl } from "./window.js";

let controller: DesktopAppController | null = null;
let quitting = false;

async function bootstrap(): Promise<void> {
  const preloadPath = fileURLToPath(new URL("./preload.mjs", import.meta.url));
  const desktopConfig = resolveDesktopLaunchConfig({
    userDataDir: app.getPath("userData"),
  });

  controller = new DesktopAppController({
    createWindow: () => createMainWindow(preloadPath),
    startSidecar: async () => {
      const paths = createSidecarPaths({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        userDataDir: app.getPath("userData"),
      });

      return startDesktopSidecar({
        paths,
        stateDir: desktopConfig.stateDir,
        hostOverride: desktopConfig.hostOverride,
        portOverride: desktopConfig.portOverride,
        password: desktopConfig.password,
      });
    },
    loadDesktopUrl,
    showErrorPage: showDesktopErrorPage,
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
