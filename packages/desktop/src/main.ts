import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  type Event,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  session,
  shell,
} from "electron";
import { BackendManager } from "./backend-manager.js";
import type { ProductRuntime } from "./runtime-store.js";
import { RuntimeStore } from "./runtime-store.js";
import { ProductRuntimeUpdateManager } from "./runtime-update-manager.js";
import { DesktopUpdateManager } from "./update-manager.js";

declare const __CODER_STUDIO_RUNTIME_PUBLIC_KEY__: string;
declare const __CODER_STUDIO_RUNTIME_UPDATE_URL__: string;

let mainWindow: BrowserWindow | null = null;
let backendManager: BackendManager | null = null;
let updateManager: DesktopUpdateManager | null = null;
let runtimeUpdateManager: ProductRuntimeUpdateManager | null = null;
let activeProductRuntime: ProductRuntime | null = null;
let appOrigin: string | null = null;
let shutdownComplete = false;
let shutdownStarted = false;
const smokeResultPath = process.env.CODER_STUDIO_DESKTOP_SMOKE_RESULT?.trim() || null;

async function finishSmokeTest(result: Record<string, unknown>, exitCode = 0): Promise<void> {
  if (!smokeResultPath) return;
  await writeFile(smokeResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.exitCode = exitCode;
  app.quit();
}

function isSafeExternalUrl(value: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function openExternal(value: string): Promise<boolean> {
  if (!isSafeExternalUrl(value)) return false;
  await shell.openExternal(value);
  return true;
}

async function waitForUrl(url: string, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for desktop UI: ${url}`);
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:select-workspace-directory", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:open-external", (_event, value: unknown) =>
    typeof value === "string" ? openExternal(value) : false
  );
  ipcMain.handle("desktop:get-backend-status", () => backendManager?.getStatus() ?? null);
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [process.platform === "darwin" ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => void updateManager?.check(true),
        },
        {
          label: "Coder Studio on GitHub",
          click: () => void openExternal("https://github.com/spencerkit/coder-studio"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(url: string): BrowserWindow {
  appOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#111318",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (!smokeResultPath) window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin === appOrigin) return;
    event.preventDefault();
    void openExternal(target);
  });
  if (smokeResultPath) {
    window.webContents.once("did-finish-load", () => {
      void finishSmokeTest({ loaded: true, backend: backendManager?.getStatus() ?? null });
    });
  }

  void window.loadURL(url);
  return window;
}

async function handleUnexpectedBackendExit(details: {
  code: number | null;
  signal: NodeJS.Signals | null;
}): Promise<void> {
  if (shutdownStarted) return;
  if (smokeResultPath) {
    await finishSmokeTest({ loaded: false, error: "backend_exited", details }, 1);
    return;
  }
  const options: MessageBoxOptions = {
    type: "error",
    title: "Coder Studio backend stopped",
    message: "The local backend exited unexpectedly.",
    detail: details.code !== null ? `Exit code: ${details.code}` : `Signal: ${details.signal}`,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0 || !backendManager) {
    app.quit();
    return;
  }
  try {
    const status = await backendManager.start(session.defaultSession);
    const url = process.env.CODER_STUDIO_DESKTOP_DEV_URL?.trim() || status.url;
    await waitForUrl(url);
    await mainWindow?.loadURL(url);
  } catch (error) {
    dialog.showErrorBox(
      "Unable to restart Coder Studio",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
  }
}

async function startApplication(): Promise<void> {
  registerIpcHandlers();
  const userDataDir = app.getPath("userData");
  const runtimePublicKey =
    typeof __CODER_STUDIO_RUNTIME_PUBLIC_KEY__ === "string"
      ? __CODER_STUDIO_RUNTIME_PUBLIC_KEY__.trim()
      : "";
  const runtimeStore = app.isPackaged
    ? new RuntimeStore({
        root: join(userDataDir, "runtime-store"),
        factoryRuntimeRoot: join(process.resourcesPath, "factory-runtime"),
        shellVersion: app.getVersion(),
        nodeVersion: "24.19.0",
        publicKeyPem: runtimePublicKey || undefined,
      })
    : null;
  let runtime = runtimeStore ? await runtimeStore.getLaunchCandidate() : null;

  const createBackendManager = (productRuntime: ProductRuntime | null) =>
    new BackendManager({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      logsDir: app.getPath("logs"),
      resourcesPath: process.resourcesPath,
      productRuntimeDir: productRuntime?.root,
      runtimeDir: join(userDataDir, "runtime"),
      stateDir: process.env.CODER_STUDIO_DESKTOP_STATE_DIR?.trim() || join(userDataDir, "data"),
      uploadsDir:
        process.env.CODER_STUDIO_DESKTOP_UPLOADS_DIR?.trim() || join(userDataDir, "uploads"),
      onUnexpectedExit: (details) => void handleUnexpectedBackendExit(details),
    });

  let status: Awaited<ReturnType<BackendManager["start"]>>;
  let url: string;
  for (;;) {
    backendManager = createBackendManager(runtime);
    try {
      status = await backendManager.start(session.defaultSession);
      url = process.env.CODER_STUDIO_DESKTOP_DEV_URL?.trim() || status.url;
      await waitForUrl(url);
      if (runtimeStore && runtime && status.source === "managed") {
        await runtimeStore.markLaunchSuccessful(runtime);
      }
      activeProductRuntime = runtime;
      break;
    } catch (error) {
      await backendManager.stop().catch(() => undefined);
      if (!runtimeStore || !runtime) throw error;
      runtime = await runtimeStore.fallbackAfterFailure(runtime, error);
    }
  }
  mainWindow = createMainWindow(url);
  updateManager = new DesktopUpdateManager({
    currentVersion: app.getVersion(),
    getWindow: () => mainWindow,
    isPackaged: app.isPackaged && !smokeResultPath,
  });
  updateManager.start();
  if (runtimeStore && activeProductRuntime && runtimePublicKey && !smokeResultPath) {
    const compiledUpdateUrl =
      typeof __CODER_STUDIO_RUNTIME_UPDATE_URL__ === "string"
        ? __CODER_STUDIO_RUNTIME_UPDATE_URL__.trim()
        : "";
    runtimeUpdateManager = new ProductRuntimeUpdateManager({
      store: runtimeStore,
      manifestUrl: process.env.CODER_STUDIO_RUNTIME_UPDATE_URL?.trim() || compiledUpdateUrl,
      getCurrentRuntime: () => activeProductRuntime as ProductRuntime,
      onError: (error) => console.warn("[runtime-update]", error.message),
      onUpdateReady: (readyRuntime) => {
        if (!mainWindow) return;
        void dialog
          .showMessageBox(mainWindow, {
            type: "info",
            title: "Coder Studio Runtime update ready",
            message: `Runtime ${readyRuntime.manifest.runtimeVersion} is ready to install.`,
            detail: "Restart Coder Studio to activate the Server and Web update.",
            buttons: ["Restart Now", "Later"],
            defaultId: 0,
            cancelId: 1,
          })
          .then((result) => {
            if (result.response !== 0) return;
            app.relaunch();
            app.quit();
          });
      },
    });
    runtimeUpdateManager.start();
  }
  installApplicationMenu();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(startApplication)
    .catch(async (error) => {
      if (smokeResultPath) {
        await finishSmokeTest(
          {
            loaded: false,
            error: error instanceof Error ? error.stack || error.message : String(error),
          },
          1
        );
        return;
      }
      dialog.showErrorBox(
        "Unable to start Coder Studio",
        error instanceof Error ? error.stack || error.message : String(error)
      );
      app.quit();
    });
}

app.on("activate", () => {
  if (!mainWindow && appOrigin) mainWindow = createMainWindow(appOrigin);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event: Event) => {
  if (shutdownComplete || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  updateManager?.stop();
  runtimeUpdateManager?.stop();
  void (backendManager?.stop() ?? Promise.resolve())
    .catch(() => undefined)
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
