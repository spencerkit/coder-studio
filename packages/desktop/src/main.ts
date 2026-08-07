import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
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
  type Session,
  session,
  shell,
} from "electron";
import { BackendManager } from "./backend-manager.js";
import {
  createEnvironmentInstanceArgs,
  getEnvironmentInstanceRoot,
  readEnvironmentInstanceTarget,
} from "./environment-instance.js";
import { DesktopEnvironmentManager } from "./environment-manager.js";
import { EnvironmentStateStore, NATIVE_ENVIRONMENT } from "./environment-state.js";
import { DesktopGateway } from "./gateway.js";
import type {
  DesktopEnvironmentProgress,
  DesktopEnvironmentTarget,
  DesktopRuntimeUpdateState,
} from "./protocol.js";
import { DESKTOP_NODE_VERSION } from "./runtime-manifest.js";
import type { ProductRuntime } from "./runtime-store.js";
import { RuntimeStore } from "./runtime-store.js";
import { ProductRuntimeUpdateManager } from "./runtime-update-manager.js";
import { DesktopUpdateManager } from "./update-manager.js";
import { createWslBackendLaunch } from "./wsl-backend.js";
import { WslDiscovery } from "./wsl-discovery.js";
import { windowsWslPathToLinux } from "./wsl-path.js";
import type { WslRuntimeCandidate } from "./wsl-runtime-store.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

declare const __CODER_STUDIO_RUNTIME_PUBLIC_KEY__: string;
declare const __CODER_STUDIO_RUNTIME_UPDATE_URL__: string;
declare const __CODER_STUDIO_PRODUCT_VERSION__: string;

let mainWindow: BrowserWindow | null = null;
let backendManager: BackendManager | null = null;
let desktopGateway: DesktopGateway | null = null;
let activeSession: Session | null = null;
let activeGatewayUrl: string | null = null;
let updateManager: DesktopUpdateManager | null = null;
let runtimeUpdateManager: ProductRuntimeUpdateManager | null = null;
let activeProductRuntime: ProductRuntime | null = null;
let environmentManager: DesktopEnvironmentManager | null = null;
let activeEnvironmentTarget: DesktopEnvironmentTarget = NATIVE_ENVIRONMENT;
let environmentOpening = false;
let environmentInstanceRoot: string | null = null;
let appOrigin: string | null = null;
let shutdownComplete = false;
let shutdownStarted = false;
const smokeResultPath = process.env.CODER_STUDIO_DESKTOP_SMOKE_RESULT?.trim() || null;

function getEnvironmentPartition(target: DesktopEnvironmentTarget): string {
  const id = createHash("sha256").update(target.id).digest("hex").slice(0, 16);
  return `persist:coder-studio-${id}`;
}

function getReleaseBaseUrl(runtimeUpdateUrl: string): string {
  const override = process.env.CODER_STUDIO_RELEASE_BASE_URL?.trim();
  if (override) return override.endsWith("/") ? override : `${override}/`;
  return new URL(".", runtimeUpdateUrl).toString();
}

function emitEnvironmentProgress(progress: DesktopEnvironmentProgress): void {
  mainWindow?.webContents.send("desktop:environment-progress", progress);
}

async function openEnvironmentInstance(
  rootUserDataDir: string,
  target: DesktopEnvironmentTarget
): Promise<void> {
  await new Promise<void>((resolveOpened, rejectOpened) => {
    const child = spawn(process.execPath, createEnvironmentInstanceArgs(rootUserDataDir, target), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", rejectOpened);
    child.once("spawn", () => {
      child.unref();
      resolveOpened();
    });
  });
}

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

async function promptForRuntimeRestart(runtimeVersion: string): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Coder Studio Runtime update ready",
    message: `Runtime ${runtimeVersion} is ready to install.`,
    detail: "Restart Coder Studio to activate the Server and Web update.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response !== 0) return;
  app.relaunch();
  app.quit();
}

async function checkRuntimeUpdatesManually(): Promise<void> {
  if (!mainWindow) return;
  if (!runtimeUpdateManager || !activeProductRuntime) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Product Runtime updates unavailable",
      message: "Runtime updates are not enabled for this Coder Studio instance.",
      detail:
        "Runtime updates require a packaged Local Windows instance with a trusted update channel.",
    });
    return;
  }

  try {
    const result = await runtimeUpdateManager.check();
    switch (result.status) {
      case "ready":
        // onUpdateReady owns the restart prompt for both automatic and manual checks.
        return;
      case "current":
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Product Runtime is up to date",
          message: `Runtime ${activeProductRuntime.manifest.runtimeVersion} is the latest available version.`,
        });
        return;
      case "already-staged": {
        const pendingVersion = await runtimeUpdateManager.getPendingVersion();
        await promptForRuntimeRestart(pendingVersion ?? "update");
        return;
      }
      case "failed":
        await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Product Runtime update quarantined",
          message: "The latest Runtime was previously rolled back after a failed launch.",
          detail: "Coder Studio will keep the current Runtime until a newer version is published.",
        });
        return;
      case "disabled":
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Product Runtime updates unavailable",
          message: "No Runtime update channel is configured.",
        });
    }
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Unable to check for Product Runtime updates",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function reportRuntimeUpdateError(error: Error): void {
  console.warn("[runtime-update]", error.message);
  const entry = `[${new Date().toISOString()}] ${error.stack || error.message}\n`;
  void appendFile(join(app.getPath("logs"), "runtime-update.log"), entry, "utf8").catch(
    (writeError) => console.warn("[runtime-update] unable to write update log", writeError)
  );
}

async function getRuntimeUpdateState(): Promise<DesktopRuntimeUpdateState> {
  if (runtimeUpdateManager) return runtimeUpdateManager.getState();
  return {
    supported: false,
    currentVersion: activeProductRuntime?.manifest.runtimeVersion ?? "0.0.0",
    latestVersion: null,
    pendingVersion: null,
    lastCheckedAt: null,
    status: "disabled",
    errorSummary: null,
    unsupportedReason:
      activeEnvironmentTarget.kind === "wsl"
        ? "Product Runtime updates are managed by the Local Windows instance"
        : "Product Runtime updates are unavailable for this Desktop instance",
  };
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

function registerIpcHandlers(rootUserDataDir: string): void {
  ipcMain.handle("desktop:get-app-version", () => app.getVersion());
  ipcMain.handle("desktop:select-workspace-directory", async () => {
    if (!mainWindow) return null;
    const activeDistro =
      activeEnvironmentTarget.kind === "wsl" ? activeEnvironmentTarget.distro : undefined;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open workspace",
      ...(activeDistro ? { defaultPath: `\\\\wsl.localhost\\${activeDistro}\\` } : {}),
      properties: ["openDirectory", "createDirectory"],
    });
    const selectedPath = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!selectedPath || !activeDistro) return selectedPath;
    return windowsWslPathToLinux(selectedPath, activeDistro);
  });
  ipcMain.handle("desktop:open-external", (_event, value: unknown) =>
    typeof value === "string" ? openExternal(value) : false
  );
  ipcMain.handle("desktop:get-backend-status", () => backendManager?.getStatus() ?? null);
  ipcMain.handle("desktop:get-runtime-update-state", getRuntimeUpdateState);
  ipcMain.handle("desktop:check-runtime-update", async () => {
    if (!runtimeUpdateManager) return getRuntimeUpdateState();
    try {
      await runtimeUpdateManager.check();
    } catch {
      // The manager records a serializable error state for the renderer.
    }
    return runtimeUpdateManager.getState();
  });
  ipcMain.handle("desktop:restart-for-runtime-update", async () => {
    if (!runtimeUpdateManager || !(await runtimeUpdateManager.getPendingVersion())) return false;
    setImmediate(() => {
      app.relaunch();
      app.quit();
    });
    return true;
  });
  ipcMain.handle("desktop:list-environments", async () => {
    if (!environmentManager) throw new Error("Desktop environments are not initialized");
    return environmentManager.listEnvironments();
  });
  ipcMain.handle("desktop:get-active-environment", async () => {
    if (!environmentManager) throw new Error("Desktop environments are not initialized");
    return environmentManager.getActiveEnvironment();
  });
  ipcMain.handle("desktop:open-environment", async (_event, environmentId: unknown) => {
    if (!environmentManager) throw new Error("Desktop environments are not initialized");
    if (typeof environmentId !== "string") throw new Error("Invalid Desktop environment id");
    if (environmentOpening) throw new Error("A Desktop environment is already being opened");
    const target = await environmentManager.resolveTarget(environmentId);
    if (target.id === activeEnvironmentTarget.id) return { status: "unchanged" as const };

    environmentOpening = true;
    try {
      if (target.kind === "wsl") await environmentManager.prepareWsl(target);
      emitEnvironmentProgress({
        environmentId: target.id,
        phase: "launching",
        message: `Opening ${target.label}…`,
        percent: 100,
      });
      await openEnvironmentInstance(rootUserDataDir, target);
      return { status: "opened" as const };
    } finally {
      environmentOpening = false;
    }
  });
}

async function handleStartupFailure(error: unknown): Promise<void> {
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

  const details = error instanceof Error ? error.stack || error.message : String(error);
  if (activeEnvironmentTarget.kind !== "wsl" || !environmentManager) {
    dialog.showErrorBox("Unable to start Coder Studio", details);
    app.quit();
    return;
  }

  const result = await dialog.showMessageBox({
    type: "error",
    title: "Unable to start the WSL environment",
    message: `${activeEnvironmentTarget.label} could not be started.`,
    detail: details,
    buttons: ["Retry", "Open Local Windows", "Quit"],
    defaultId: 0,
    cancelId: 2,
  });
  if (result.response === 0) app.relaunch();
  if (result.response === 1 && environmentInstanceRoot) {
    await openEnvironmentInstance(environmentInstanceRoot, NATIVE_ENVIRONMENT);
  }
  app.quit();
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
          label: "Check for Desktop App Updates...",
          click: () => void updateManager?.check(true),
        },
        {
          label: "Check for Product Runtime Updates...",
          click: () => void checkRuntimeUpdatesManually(),
        },
        { type: "separator" },
        {
          label: "Coder Studio on GitHub",
          click: () => void openExternal("https://github.com/spencerkit/coder-studio"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(url: string, browserSession = activeSession): BrowserWindow {
  appOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    title: `Coder Studio — ${activeEnvironmentTarget.label}`,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#111318",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      ...(browserSession ? { session: browserSession } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (!smokeResultPath) window.once("ready-to-show", () => window.show());
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(`Coder Studio — ${activeEnvironmentTarget.label}`);
  });
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
    const status = await backendManager.start(activeSession ?? session.defaultSession);
    desktopGateway?.setBackendUrl(status.url);
    if (desktopGateway && activeGatewayUrl) {
      await backendManager.authenticatePublicSession(
        activeSession ?? session.defaultSession,
        activeGatewayUrl
      );
    }
    const url = process.env.CODER_STUDIO_DESKTOP_DEV_URL?.trim() || activeGatewayUrl || status.url;
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
  const userDataDir = app.getPath("userData");
  const rootUserDataDir = getEnvironmentInstanceRoot(app.commandLine, userDataDir);
  environmentInstanceRoot = rootUserDataDir;
  registerIpcHandlers(rootUserDataDir);
  const runtimePublicKey =
    typeof __CODER_STUDIO_RUNTIME_PUBLIC_KEY__ === "string"
      ? __CODER_STUDIO_RUNTIME_PUBLIC_KEY__.trim()
      : "";
  const compiledRuntimeUpdateUrl =
    typeof __CODER_STUDIO_RUNTIME_UPDATE_URL__ === "string"
      ? __CODER_STUDIO_RUNTIME_UPDATE_URL__.trim()
      : "";
  const productVersion =
    typeof __CODER_STUDIO_PRODUCT_VERSION__ === "string"
      ? __CODER_STUDIO_PRODUCT_VERSION__.trim()
      : "0.0.0";
  const runtimeStore = app.isPackaged
    ? new RuntimeStore({
        root: join(rootUserDataDir, "runtime-store"),
        factoryRuntimeRoot: join(process.resourcesPath, "factory-runtime"),
        shellVersion: app.getVersion(),
        nodeVersion: DESKTOP_NODE_VERSION,
        publicKeyPem: runtimePublicKey || undefined,
      })
    : null;
  let webRuntime = runtimeStore ? await runtimeStore.getLaunchCandidate() : null;
  const environmentStateStore = new EnvironmentStateStore(userDataDir);
  environmentManager = new DesktopEnvironmentManager({
    stateStore: environmentStateStore,
    discovery: new WslDiscovery(),
    shellVersion: app.getVersion(),
    nodeVersion: DESKTOP_NODE_VERSION,
    runtimeVersion: webRuntime?.manifest.runtimeVersion ?? productVersion,
    publicKeyPem: runtimePublicKey,
    enableWsl: app.isPackaged && process.platform === "win32",
    releaseBaseUrl: getReleaseBaseUrl(
      process.env.CODER_STUDIO_RUNTIME_UPDATE_URL?.trim() || compiledRuntimeUpdateUrl
    ),
    onProgress: emitEnvironmentProgress,
  });
  activeEnvironmentTarget = app.isPackaged
    ? readEnvironmentInstanceTarget(app.commandLine)
    : NATIVE_ENVIRONMENT;
  environmentManager.setActiveTarget(activeEnvironmentTarget);
  activeSession = session.fromPartition(getEnvironmentPartition(activeEnvironmentTarget));

  let wslRuntime: WslRuntimeCandidate | null = null;
  let wslRuntimeStore: WslRuntimeStoreClient | null = null;
  let wslProbe: Awaited<ReturnType<DesktopEnvironmentManager["prepareWsl"]>>["probe"] | null = null;
  if (activeEnvironmentTarget.kind === "wsl") {
    const prepared = await environmentManager.prepareWsl(activeEnvironmentTarget);
    wslProbe = prepared.probe;
    wslRuntimeStore = prepared.runtimeStore;
    wslRuntime = prepared.runtime;
  }

  const createBackendManager = () =>
    new BackendManager({
      appVersion:
        activeEnvironmentTarget.kind === "wsl"
          ? (wslRuntime?.manifest.runtimeVersion ?? productVersion)
          : (webRuntime?.manifest.runtimeVersion ?? productVersion),
      isPackaged: app.isPackaged,
      logsDir: app.getPath("logs"),
      resourcesPath: process.resourcesPath,
      productRuntimeDir:
        activeEnvironmentTarget.kind === "wsl" ? wslRuntime?.root : webRuntime?.root,
      runtimeDir: join(userDataDir, "runtime"),
      stateDir: process.env.CODER_STUDIO_DESKTOP_STATE_DIR?.trim() || join(userDataDir, "data"),
      uploadsDir:
        process.env.CODER_STUDIO_DESKTOP_UPLOADS_DIR?.trim() || join(userDataDir, "uploads"),
      ...(activeEnvironmentTarget.kind === "wsl" && wslProbe && wslRuntime
        ? {
            createLaunch: (context: Parameters<typeof createWslBackendLaunch>[2]) =>
              createWslBackendLaunch(
                wslProbe,
                wslRuntime as WslRuntimeCandidate,
                context,
                userDataDir
              ),
          }
        : {}),
      onUnexpectedExit: (details) => void handleUnexpectedBackendExit(details),
    });

  let status: Awaited<ReturnType<BackendManager["start"]>>;
  let url: string;
  for (;;) {
    backendManager = createBackendManager();
    try {
      status = await backendManager.start(activeSession);
      const developmentUrl = process.env.CODER_STUDIO_DESKTOP_DEV_URL?.trim();
      if (app.isPackaged && webRuntime && status.source === "managed") {
        if (!webRuntime.manifest.webRoot) {
          throw new Error("The selected Product Runtime does not contain the shared Web payload");
        }
        const webRoot = join(webRuntime.root, webRuntime.manifest.webRoot);
        desktopGateway = new DesktopGateway({ backendUrl: status.url, webRoot });
        const gatewayStatus = await desktopGateway.start();
        activeGatewayUrl = gatewayStatus.url;
        await backendManager.authenticatePublicSession(activeSession, gatewayStatus.url);
        url = gatewayStatus.url;
      } else {
        url = developmentUrl || status.url;
      }
      await waitForUrl(url);
      if (runtimeStore && webRuntime && status.source === "managed") {
        await runtimeStore.markLaunchSuccessful(webRuntime);
      }
      if (activeEnvironmentTarget.kind === "wsl" && wslRuntimeStore && wslRuntime) {
        await wslRuntimeStore.markLaunchSuccessful(wslRuntime);
      }
      await environmentManager.markLaunchSuccessful(activeEnvironmentTarget);
      activeProductRuntime = webRuntime;
      break;
    } catch (error) {
      await desktopGateway?.stop().catch(() => undefined);
      desktopGateway = null;
      activeGatewayUrl = null;
      await backendManager.stop().catch(() => undefined);
      if (activeEnvironmentTarget.kind === "wsl") {
        if (!wslRuntimeStore || !wslRuntime) throw error;
        await wslRuntimeStore.fallbackAfterFailure(wslRuntime, error);
        wslRuntime = await wslRuntimeStore.getLaunchCandidate();
        if (!environmentManager.isRuntimeCompatible(wslRuntime.manifest)) throw error;
      } else {
        if (!runtimeStore || !webRuntime) throw error;
        webRuntime = await runtimeStore.fallbackAfterFailure(webRuntime, error);
      }
    }
  }
  if (
    runtimeStore &&
    activeProductRuntime &&
    runtimePublicKey &&
    activeEnvironmentTarget.kind === "native" &&
    !smokeResultPath
  ) {
    runtimeUpdateManager = new ProductRuntimeUpdateManager({
      store: runtimeStore,
      manifestUrl: process.env.CODER_STUDIO_RUNTIME_UPDATE_URL?.trim() || compiledRuntimeUpdateUrl,
      getCurrentRuntime: () => activeProductRuntime as ProductRuntime,
      onError: reportRuntimeUpdateError,
      onStateChanged: (state) => {
        mainWindow?.webContents.send("desktop:runtime-update-state-changed", state);
      },
      onUpdateReady: (readyRuntime) => {
        void promptForRuntimeRestart(readyRuntime.manifest.runtimeVersion);
      },
    });
  }
  mainWindow = createMainWindow(url);
  updateManager = new DesktopUpdateManager({
    currentVersion: app.getVersion(),
    getWindow: () => mainWindow,
    isPackaged: app.isPackaged && activeEnvironmentTarget.kind === "native" && !smokeResultPath,
  });
  updateManager.start();
  runtimeUpdateManager?.start();
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

  app.whenReady().then(startApplication).catch(handleStartupFailure);
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
  void (desktopGateway?.stop() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => backendManager?.stop() ?? Promise.resolve())
    .catch(() => undefined)
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
