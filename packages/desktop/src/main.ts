import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDefaultProductUpdateState,
  type ProductUpdateState,
  type UpdateRuntimeContext,
} from "@coder-studio/core";
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
import { autoUpdater, CancellationToken } from "electron-updater";
import { BackendManager } from "./backend-manager.js";
import { readDesktopBuildInfo } from "./build-info.js";
import {
  DesktopAuthRecoveryCoordinator,
  isDesktopNetworkService,
} from "./desktop-auth-recovery.js";
import {
  parseDesktopChannel,
  resolveDesktopChannelUrl,
  resolveDesktopRuntimePublicKey,
  shouldForceAcceptanceRuntimeHealthFailure,
} from "./desktop-channel.js";
import { installDesktopContextMenu } from "./desktop-context-menu.js";
import { DesktopUpdateCoordinator } from "./desktop-update-coordinator.js";
import { registerDesktopUpdateIpc, toLegacyRuntimeUpdateState } from "./desktop-update-ipc.js";
import { DesktopUpdateJournal } from "./desktop-update-journal.js";
import { DesktopUpdateSettingsRepo } from "./desktop-update-settings.js";
import { EnvironmentActivationCoordinator } from "./environment-activation.js";
import {
  createEnvironmentInstanceArgs,
  getEnvironmentInstanceRoot,
  readEnvironmentInstanceTarget,
  readEnvironmentLaunchRequestId,
  waitForEnvironmentInstanceReady,
} from "./environment-instance.js";
import {
  createEnvironmentLaunchingProgress,
  EnvironmentLaunchStore,
  isEnvironmentLaunchRequestId,
  prepareEnvironmentLaunch,
  settleEnvironmentLaunchFailure,
} from "./environment-launch.js";
import { DesktopEnvironmentManager } from "./environment-manager.js";
import { EnvironmentStateStore, NATIVE_ENVIRONMENT } from "./environment-state.js";
import { DesktopGateway } from "./gateway.js";
import type { DesktopEnvironmentProgress, DesktopEnvironmentTarget } from "./protocol.js";
import { DESKTOP_NODE_VERSION, getRuntimePublishedAt } from "./runtime-manifest.js";
import type { ProductRuntime } from "./runtime-store.js";
import { RuntimeStore } from "./runtime-store.js";
import { ProductRuntimeUpdateManager } from "./runtime-update-manager.js";
import { DesktopShellUpdateAdapter, type ShellUpdaterPort } from "./update-manager.js";
import { readDesktopWindowActivityState } from "./window-activity.js";
import { createWslBackendLaunch } from "./wsl-backend.js";
import { WslDiscovery } from "./wsl-discovery.js";
import { windowsWslPathToLinux } from "./wsl-path.js";
import type { WslRuntimeCandidate } from "./wsl-runtime-store.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

declare const __CODER_STUDIO_RUNTIME_PUBLIC_KEY__: string;
declare const __CODER_STUDIO_DESKTOP_CHANNEL_URL__: string;
declare const __CODER_STUDIO_FACTORY_RELEASE_BASE_URL__: string;
declare const __CODER_STUDIO_PRODUCT_VERSION__: string;

const ENVIRONMENT_LAUNCH_DATA_KEY = "environmentLaunchRequestId";
const ENVIRONMENT_LAUNCH_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const ENVIRONMENT_SHUTDOWN_FAILURE_MESSAGE = "Coder Studio is shutting down";

let mainWindow: BrowserWindow | null = null;
let backendManager: BackendManager | null = null;
let desktopGateway: DesktopGateway | null = null;
let activeSession: Session | null = null;
let activeGatewayUrl: string | null = null;
let updateCoordinator: DesktopUpdateCoordinator | null = null;
let activeProductRuntime: ProductRuntime | null = null;
let environmentManager: DesktopEnvironmentManager | null = null;
let activeEnvironmentTarget: DesktopEnvironmentTarget = NATIVE_ENVIRONMENT;
let environmentOpening = false;
let environmentInstanceRoot: string | null = null;
let environmentLaunchStore: EnvironmentLaunchStore | null = null;
let releaseProductRuntimeLease: (() => Promise<void>) | null = null;
let appOrigin: string | null = null;
let shutdownComplete = false;
let shutdownStarted = false;
let shutdownActivationPromise: Promise<void> = Promise.resolve();
const smokeResultPath = process.env.CODER_STUDIO_DESKTOP_SMOKE_RESULT?.trim() || null;
const desktopAuthRecovery = new DesktopAuthRecoveryCoordinator({
  canRecover: () =>
    !shutdownStarted &&
    backendManager?.getStatus()?.source === "managed" &&
    activeSession !== null &&
    activeGatewayUrl !== null,
  authenticate: async () => {
    const manager = backendManager;
    const browserSession = activeSession;
    const gatewayUrl = activeGatewayUrl;
    if (!manager || !browserSession || !gatewayUrl) {
      throw new Error("Desktop authentication recovery is not ready");
    }

    try {
      const response = await browserSession.fetch(`${gatewayUrl}/auth/status`);
      if (response.ok) {
        const status = (await response.json()) as { authenticated?: unknown };
        if (status.authenticated === true) return "already_authenticated";
      }
    } catch {
      // A newly relaunched Network Service may fail its first request. The login below
      // and the coordinator retry schedule provide the recovery path.
    }

    await manager.authenticatePublicSession(browserSession, gatewayUrl);
    return "recovered";
  },
  onRecovered: () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("desktop:authentication-recovered");
  },
  onAttemptFailure: (error, attempt, willRetry) => {
    console.warn(
      `[desktop-auth] Recovery attempt ${attempt} failed${willRetry ? "; retrying" : ""}`,
      error
    );
  },
});
const environmentActivation = new EnvironmentActivationCoordinator({
  focusWindow: () => {
    if (shutdownStarted || !mainWindow) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  },
  markReady: async (requestId) => {
    if (shutdownStarted || !environmentLaunchStore) return;
    await environmentLaunchStore.markReady(requestId, activeEnvironmentTarget.id, process.pid);
  },
  markFailed: async (requestId, message) => {
    if (!environmentLaunchStore) return;
    await environmentLaunchStore.markFailed(requestId, activeEnvironmentTarget.id, message);
  },
});

function readLaunchRequestAdditionalData(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const requestId = (value as Record<string, unknown>)[ENVIRONMENT_LAUNCH_DATA_KEY];
  return isEnvironmentLaunchRequestId(requestId) ? requestId : undefined;
}

function trackShutdownActivation(promise: Promise<void>): Promise<void> {
  const trackedPromise = promise.catch((error) => {
    console.error("Unable to fail Desktop environment activation during shutdown", error);
  });
  shutdownActivationPromise = Promise.all([shutdownActivationPromise, trackedPromise]).then(
    () => undefined
  );
  return trackedPromise;
}

async function waitForShutdownActivations(): Promise<void> {
  for (;;) {
    const pending = shutdownActivationPromise;
    await pending;
    if (pending === shutdownActivationPromise) return;
  }
}

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
  if (!environmentLaunchStore) {
    throw new Error("Desktop environment launch store is not initialized");
  }
  const launchStore = environmentLaunchStore;
  const request = await launchStore.create(target);
  try {
    const child = spawn(
      process.execPath,
      createEnvironmentInstanceArgs(rootUserDataDir, target, request.requestId),
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    await waitForEnvironmentInstanceReady(child, () =>
      launchStore.waitForTerminal(request.requestId, target).then(() => undefined)
    );
  } catch (error) {
    await settleEnvironmentLaunchFailure(launchStore, request.requestId, target, error);
  }
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

function getFallbackUpdateState(): ProductUpdateState {
  const context: UpdateRuntimeContext = {
    environment: activeEnvironmentTarget.kind === "wsl" ? "desktop-wsl" : "desktop-native",
    authority: "none",
    supported: false,
    unsupportedReason:
      process.platform === "win32"
        ? "Desktop updates require a packaged build with a trusted signed channel"
        : "Installed Desktop updates are not yet supported on this platform",
  };
  const state = createDefaultProductUpdateState(
    context,
    activeProductRuntime?.manifest.runtimeVersion ?? "0.0.0",
    activeProductRuntime ? getRuntimePublishedAt(activeProductRuntime.manifest) : null
  );
  return {
    ...state,
    diagnostics: {
      ...state.diagnostics,
      shellVersion: app.getVersion(),
      nodeVersion: DESKTOP_NODE_VERSION,
    },
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
  registerDesktopUpdateIpc({
    ipc: ipcMain,
    getCoordinator: () => updateCoordinator,
    getFallbackState: getFallbackUpdateState,
  });
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
  ipcMain.handle("desktop:recover-authentication", () => desktopAuthRecovery.recover());
  ipcMain.handle("desktop:get-window-activity-state", () =>
    readDesktopWindowActivityState(mainWindow)
  );
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
    const manager = environmentManager;
    if (typeof environmentId !== "string") throw new Error("Invalid Desktop environment id");
    if (environmentOpening) throw new Error("A Desktop environment is already being opened");
    const target = await manager.resolveTarget(environmentId);
    if (target.id === activeEnvironmentTarget.id) return { status: "unchanged" as const };

    environmentOpening = true;
    try {
      const coordinator = updateCoordinator;
      await prepareEnvironmentLaunch({
        prepareRequired: async () => {
          if (target.kind === "wsl") await manager.prepareWsl(target);
        },
        ...(coordinator
          ? {
              prepareUpdate: () =>
                coordinator.prepareEnvironmentTarget(
                  target.kind === "wsl" ? "linux-x64" : "win32-x64",
                  target.id
                ),
            }
          : {}),
        onUpdateFailure: (error) => {
          console.warn(
            `[desktop-update] Unable to prepare updates for ${target.label}; continuing with the compatible Runtime`,
            error
          );
        },
      });
      emitEnvironmentProgress(createEnvironmentLaunchingProgress(target));
      await openEnvironmentInstance(rootUserDataDir, target);
      return { status: "opened" as const };
    } finally {
      environmentOpening = false;
    }
  });
}

async function handleStartupFailure(error: unknown): Promise<void> {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  console.error("Unable to start Coder Studio", details);
  await environmentActivation.failPending(details).catch(() => undefined);
  if (smokeResultPath) {
    await finishSmokeTest(
      {
        loaded: false,
        error: details,
      },
      1
    );
    return;
  }

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
  try {
    if (result.response === 0) app.relaunch();
    if (result.response === 1) {
      try {
        if (!environmentInstanceRoot) {
          throw new Error("Desktop environment root is not initialized");
        }
        await openEnvironmentInstance(environmentInstanceRoot, NATIVE_ENVIRONMENT);
      } catch (fallbackError) {
        const fallbackDetails =
          fallbackError instanceof Error
            ? fallbackError.stack || fallbackError.message
            : String(fallbackError);
        dialog.showErrorBox("Unable to open Local Windows", fallbackDetails);
      }
    }
  } finally {
    app.quit();
  }
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
          click: () => void updateCoordinator?.check({ manual: true }),
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

  if (!smokeResultPath) {
    window.once("ready-to-show", () => {
      if (shutdownStarted) return;
      void environmentActivation
        .markWindowReady()
        .catch((error) =>
          console.error("Unable to acknowledge environment window readiness", error)
        );
    });
  }
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(`Coder Studio — ${activeEnvironmentTarget.label}`);
  });
  const emitWindowActivityState = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(
      "desktop:window-activity-state-changed",
      readDesktopWindowActivityState(window)
    );
  };
  window.on("focus", emitWindowActivityState);
  window.on("blur", emitWindowActivityState);
  window.on("minimize", emitWindowActivityState);
  window.on("restore", emitWindowActivityState);
  window.on("show", emitWindowActivityState);
  window.on("hide", emitWindowActivityState);
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      environmentActivation.markWindowUnavailable();
    }
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void openExternal(target);
    return { action: "deny" };
  });
  installDesktopContextMenu(window, Menu);
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
  environmentLaunchStore = new EnvironmentLaunchStore(rootUserDataDir);
  void environmentLaunchStore.cleanupStale(ENVIRONMENT_LAUNCH_MAX_AGE_MS).catch(() => undefined);
  activeEnvironmentTarget = app.isPackaged
    ? readEnvironmentInstanceTarget(app.commandLine)
    : NATIVE_ENVIRONMENT;
  registerIpcHandlers(rootUserDataDir);
  const compiledRuntimePublicKey =
    typeof __CODER_STUDIO_RUNTIME_PUBLIC_KEY__ === "string"
      ? __CODER_STUDIO_RUNTIME_PUBLIC_KEY__.trim()
      : "";
  const runtimePublicKey = resolveDesktopRuntimePublicKey(
    process.env,
    compiledRuntimePublicKey,
    (path) => readFileSync(path, "utf8")
  );
  const compiledDesktopChannelUrl =
    typeof __CODER_STUDIO_DESKTOP_CHANNEL_URL__ === "string"
      ? __CODER_STUDIO_DESKTOP_CHANNEL_URL__.trim()
      : "";
  const desktopChannelUrl = resolveDesktopChannelUrl(process.env, compiledDesktopChannelUrl);
  const loadDesktopChannel = async () => {
    if (!desktopChannelUrl || !runtimePublicKey) {
      throw new Error("Desktop update channel is not configured");
    }
    const response = await fetch(desktopChannelUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Desktop update channel check failed with ${response.status}`);
    }
    return parseDesktopChannel(await response.json(), runtimePublicKey, desktopChannelUrl);
  };
  const compiledFactoryReleaseBaseUrl =
    typeof __CODER_STUDIO_FACTORY_RELEASE_BASE_URL__ === "string"
      ? __CODER_STUDIO_FACTORY_RELEASE_BASE_URL__.trim()
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
  releaseProductRuntimeLease =
    runtimeStore && webRuntime ? await runtimeStore.acquireLease(webRuntime) : null;
  const environmentStateStore = new EnvironmentStateStore(userDataDir);
  const nativeRuntimeUpdateAdapter =
    runtimeStore && webRuntime && runtimePublicKey && desktopChannelUrl
      ? new ProductRuntimeUpdateManager({
          store: runtimeStore,
          manifestUrl: desktopChannelUrl,
          getCurrentRuntime: () => activeProductRuntime ?? (webRuntime as ProductRuntime),
          onError: (error) => console.warn("[runtime-update]", error.message),
        })
      : undefined;
  environmentManager = new DesktopEnvironmentManager({
    stateStore: environmentStateStore,
    discovery: new WslDiscovery({
      probeUserShell: process.env.CODER_STUDIO_DESKTOP_ACCEPTANCE !== "1",
    }),
    shellVersion: app.getVersion(),
    nodeVersion: DESKTOP_NODE_VERSION,
    runtimeVersion: webRuntime?.manifest.runtimeVersion ?? productVersion,
    publicKeyPem: runtimePublicKey,
    enableWsl: app.isPackaged && process.platform === "win32",
    releaseBaseUrl: getReleaseBaseUrl(
      process.env.CODER_STUDIO_RUNTIME_UPDATE_URL?.trim() || desktopChannelUrl
    ),
    factoryReleaseBaseUrl:
      process.env.CODER_STUDIO_FACTORY_RELEASE_BASE_URL?.trim() ||
      compiledFactoryReleaseBaseUrl ||
      undefined,
    loadChannel: desktopChannelUrl && runtimePublicKey ? loadDesktopChannel : undefined,
    nativeRuntimeUpdateAdapter,
    onProgress: (progress) => {
      emitEnvironmentProgress(progress);
      if (process.env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1") {
        console.error(
          `[desktop-acceptance:environment] ${new Date().toISOString()} ${JSON.stringify(progress)}`
        );
      }
    },
  });
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
      toolsDir: join(userDataDir, "tools"),
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
      if (
        webRuntime &&
        shouldForceAcceptanceRuntimeHealthFailure(
          process.env,
          webRuntime.source,
          webRuntime.manifest.runtimeVersion
        )
      ) {
        throw new Error(
          `Acceptance-injected Runtime health failure for ${webRuntime.manifest.runtimeVersion}`
        );
      }
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
        wslRuntime = await wslRuntimeStore.getLaunchCandidate({
          requiredRuntimeVersion: webRuntime?.manifest.runtimeVersion ?? productVersion,
        });
        if (!environmentManager.isRuntimeCompatible(wslRuntime.manifest)) throw error;
      } else {
        if (!runtimeStore || !webRuntime) throw error;
        await releaseProductRuntimeLease?.().catch(() => undefined);
        webRuntime = await runtimeStore.fallbackAfterFailure(webRuntime, error);
        releaseProductRuntimeLease = await runtimeStore.acquireLease(webRuntime);
      }
    }
  }
  if (
    app.isPackaged &&
    process.platform === "win32" &&
    runtimePublicKey &&
    desktopChannelUrl &&
    nativeRuntimeUpdateAdapter &&
    !smokeResultPath
  ) {
    const buildInfo = await readDesktopBuildInfo(process.resourcesPath, app.getVersion());
    const updateJournalPath = join(rootUserDataDir, "desktop-update-plan.json");
    const updateOwnerId = randomUUID();
    const shellUpdateAdapter = new DesktopShellUpdateAdapter({
      updater: autoUpdater as unknown as ShellUpdaterPort,
      currentVersion: app.getVersion(),
      isPackaged: true,
      allowPrerelease: process.env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1",
      createCancellationToken: () => new CancellationToken(),
      logLocations: [join(app.getPath("logs"), "main.log")],
      manualInstallerUrl: "https://github.com/spencerkit/coder-studio/releases",
    });
    shellUpdateAdapter.start();
    const runtimeContext: UpdateRuntimeContext = {
      environment: activeEnvironmentTarget.kind === "wsl" ? "desktop-wsl" : "desktop-native",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    };
    updateCoordinator = new DesktopUpdateCoordinator({
      runtimeContext,
      currentProductVersion: () =>
        activeEnvironmentTarget.kind === "wsl"
          ? (wslRuntime?.manifest.runtimeVersion ?? productVersion)
          : (activeProductRuntime?.manifest.runtimeVersion ?? productVersion),
      currentSharedWebVersion: () =>
        activeProductRuntime?.manifest.runtimeVersion ??
        webRuntime?.manifest.runtimeVersion ??
        productVersion,
      currentProductPublishedAt: () => {
        const manifest =
          activeEnvironmentTarget.kind === "wsl"
            ? wslRuntime?.manifest
            : activeProductRuntime?.manifest;
        return manifest ? getRuntimePublishedAt(manifest) : null;
      },
      getBuildInfo: () => buildInfo,
      loadChannel: loadDesktopChannel,
      shell: shellUpdateAdapter,
      getRuntimeAdapter: (target, environmentId) =>
        (environmentManager as DesktopEnvironmentManager).createRuntimeUpdateAdapter(
          target,
          environmentId
        ),
      initialRuntimeTarget: activeEnvironmentTarget.kind === "wsl" ? "linux-x64" : "win32-x64",
      initialEnvironmentId: activeEnvironmentTarget.id,
      settings: new DesktopUpdateSettingsRepo({
        filePath: join(rootUserDataDir, "desktop-update-settings.json"),
        onWarning: (message) => console.warn("[desktop-update]", message),
      }),
      journal: new DesktopUpdateJournal({
        filePath: updateJournalPath,
        onWarning: (message) => console.warn("[desktop-update]", message),
      }),
      journalLocation: updateJournalPath,
      updateOwnerId,
      now: Date.now,
      randomId: randomUUID,
      onStateChanged: (state) => {
        mainWindow?.webContents.send("desktop:update-state-changed", state);
        mainWindow?.webContents.send(
          "desktop:runtime-update-state-changed",
          toLegacyRuntimeUpdateState(state)
        );
      },
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
    });
    const pendingRuntimeVersion =
      activeEnvironmentTarget.kind === "wsl"
        ? await wslRuntimeStore?.readPendingVersion()
        : await runtimeStore?.readPendingVersion();
    await updateCoordinator.reconcileOnStartup({
      shellVersion: app.getVersion(),
      runtimeVersion:
        activeEnvironmentTarget.kind === "wsl"
          ? (wslRuntime?.manifest.runtimeVersion ?? productVersion)
          : (activeProductRuntime?.manifest.runtimeVersion ?? productVersion),
      pendingRuntimeVersion: pendingRuntimeVersion ?? null,
    });
    await updateCoordinator.start();
  }
  mainWindow = createMainWindow(url);
  installApplicationMenu();
}

const initialEnvironmentLaunchRequestId = readEnvironmentLaunchRequestId(app.commandLine);
const hasSingleInstanceLock = app.requestSingleInstanceLock(
  initialEnvironmentLaunchRequestId
    ? { [ENVIRONMENT_LAUNCH_DATA_KEY]: initialEnvironmentLaunchRequestId }
    : undefined
);
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (initialEnvironmentLaunchRequestId) {
    void environmentActivation.request(initialEnvironmentLaunchRequestId);
  }
  app.on("second-instance", (_event, _argv, _workingDirectory, additionalData) => {
    const requestId = readLaunchRequestAdditionalData(additionalData);
    if (shutdownStarted) {
      if (requestId) {
        void trackShutdownActivation(environmentActivation.request(requestId));
      }
      return;
    }
    void environmentActivation.request(requestId).catch((error) => {
      console.error("Unable to activate Desktop environment window", error);
    });
  });

  app.on("child-process-gone", (_event, details) => {
    if (!isDesktopNetworkService(details)) return;
    void desktopAuthRecovery.recover({ notifyWhenAlreadyAuthenticated: true });
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
  const activationFailurePromise = trackShutdownActivation(
    environmentActivation.failPending(ENVIRONMENT_SHUTDOWN_FAILURE_MESSAGE)
  );
  const stopUpdateCoordinator = updateCoordinator?.stop() ?? Promise.resolve();
  void (desktopGateway?.stop() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => backendManager?.stop() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => releaseProductRuntimeLease?.() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => stopUpdateCoordinator)
    .catch(() => undefined)
    .then(() => activationFailurePromise)
    .then(waitForShutdownActivations)
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
