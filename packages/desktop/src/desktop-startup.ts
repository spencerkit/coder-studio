import { access, readFile } from "node:fs/promises";
import { arch as osArch, platform as osPlatform } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopAppController, showDesktopErrorPage } from "./app-controller.js";
import { type DesktopLaunchConfig, resolveDesktopLaunchConfig } from "./desktop-config.js";
import { DesktopUpdateBridge } from "./desktop-update-bridge.js";
import type { DesktopErrorPageModel } from "./error-page.js";
import { ensureRuntimeReady } from "./runtime-bootstrap.js";
import { RuntimeInstaller } from "./runtime-installer.js";
import { parseRuntimeManifest, RUNTIME_MANIFEST_FILE_NAME } from "./runtime-manifest.js";
import { GitHubRuntimeReleaseProvider } from "./runtime-release-github.js";
import { compareVersions, type RuntimeReleaseProvider } from "./runtime-release-provider.js";
import type { ActiveRuntimePointer } from "./runtime-store.js";
import { RuntimeStore } from "./runtime-store.js";
import {
  createSidecarPaths,
  type StartDesktopSidecarInput,
  startDesktopSidecar,
} from "./sidecar-manager.js";

interface AppLike {
  isPackaged: boolean;
  getAppPath(): string;
  getPath(name: string): string;
  getVersion(): string;
}

interface CreateWindowLike {
  loadURL(url: string): Promise<unknown>;
  focus(): void;
  show(): void;
}

interface StartedSidecarLike {
  browserUrl: string;
  getLogExcerpt(): string;
  send(message: unknown): void;
  stop(timeoutMs?: number): Promise<void>;
  on(
    event: "exit",
    listener: (payload: { code: number | null; signal: NodeJS.Signals | null }) => void
  ): void;
  on(event: "message", listener: (message: unknown) => void): void;
}

interface RuntimeStoreLike {
  readActiveRuntime(): Promise<{
    version: string;
    installedAt: number;
    path: string;
    entry: string;
    webRoot: string;
    checksumSha256: string;
    source: string;
    previousVersion?: string;
  } | null>;
}

interface RuntimeInstallerLike {
  installRelease: RuntimeInstaller["installRelease"];
}

interface UpdateBridgeFactoryInput {
  getSidecar: () => StartedSidecarLike | null;
  restartSidecar: () => Promise<void>;
}

interface StartupInput {
  app: AppLike;
  importMetaUrl: string;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
}

interface StartupDeps {
  resolveDesktopLaunchConfig?: (input: { userDataDir: string }) => DesktopLaunchConfig;
  createRuntimeStore?: (input: { userDataDir: string }) => RuntimeStoreLike;
  createRuntimeReleaseProvider?: () => RuntimeReleaseProvider;
  createRuntimeInstaller?: (input: { userDataDir: string }) => RuntimeInstallerLike;
  validateActiveRuntime?: (
    runtime: ActiveRuntimePointer,
    target: { appVersion: string; platform: NodeJS.Platform; arch: NodeJS.Architecture }
  ) => Promise<boolean>;
  createMainWindow?: (preloadPath: string) => CreateWindowLike;
  loadDesktopUrl?: (window: CreateWindowLike, url: string) => Promise<void>;
  showErrorPage?: (window: CreateWindowLike, model: DesktopErrorPageModel) => Promise<void>;
  createSidecarPaths?: typeof createSidecarPaths;
  startDesktopSidecar?: (
    input: StartDesktopSidecarInput,
    deps?: Parameters<typeof startDesktopSidecar>[1]
  ) => Promise<StartedSidecarLike>;
}

const DEFAULT_RUNTIME_RELEASE_INDEX_URL =
  "https://github.com/spencerkit/coder-studio/releases/latest/download/runtime-release-index.json";

async function fetchRuntimeReleaseIndex(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Runtime release index request failed with ${response.status}`);
  }
  return response.json();
}

function createDefaultRuntimeReleaseProvider(): RuntimeReleaseProvider {
  const releaseIndexUrl =
    process.env.CODER_STUDIO_DESKTOP_RUNTIME_RELEASE_INDEX_URL?.trim() ||
    DEFAULT_RUNTIME_RELEASE_INDEX_URL;

  return new GitHubRuntimeReleaseProvider({
    fetchReleaseIndex: () => fetchRuntimeReleaseIndex(releaseIndexUrl),
  });
}

function createDefaultRuntimeInstaller(input: { userDataDir: string }): RuntimeInstallerLike {
  return new RuntimeInstaller({
    userDataDir: input.userDataDir,
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateActiveRuntimePointer(
  runtime: ActiveRuntimePointer,
  target: {
    appVersion: string;
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
  }
): Promise<boolean> {
  if (
    typeof runtime.minAppVersion === "string" &&
    compareVersions(target.appVersion, runtime.minAppVersion) < 0
  ) {
    return false;
  }

  if (!(await pathExists(runtime.path))) {
    return false;
  }
  if (!(await pathExists(resolve(runtime.path, runtime.entry)))) {
    return false;
  }
  if (!(await pathExists(resolve(runtime.path, runtime.webRoot)))) {
    return false;
  }

  try {
    const manifest = parseRuntimeManifest(
      JSON.parse(await readFile(resolve(runtime.path, RUNTIME_MANIFEST_FILE_NAME), "utf-8"))
    );
    return manifest.version === runtime.version;
  } catch {
    return false;
  }
}

async function loadWindowModule(): Promise<{
  createMainWindow: (preloadPath: string) => CreateWindowLike;
  loadDesktopUrl: (window: CreateWindowLike, url: string) => Promise<void>;
}> {
  const module = await import("./window.js");
  return {
    createMainWindow: module.createMainWindow as (preloadPath: string) => CreateWindowLike,
    loadDesktopUrl: module.loadDesktopUrl as (
      window: CreateWindowLike,
      url: string
    ) => Promise<void>,
  };
}

export async function buildDesktopControllerDeps(input: StartupInput, deps: StartupDeps = {}) {
  const userDataDir = input.app.getPath("userData");
  const desktopConfig =
    deps.resolveDesktopLaunchConfig?.({ userDataDir }) ??
    resolveDesktopLaunchConfig({
      userDataDir,
    });
  const runtimeStore =
    deps.createRuntimeStore?.({ userDataDir }) ??
    new RuntimeStore({
      userDataDir,
    });
  const runtimeReleaseProvider =
    deps.createRuntimeReleaseProvider?.() ?? createDefaultRuntimeReleaseProvider();
  const runtimeInstaller =
    deps.createRuntimeInstaller?.({ userDataDir }) ??
    createDefaultRuntimeInstaller({ userDataDir });
  const validateActiveRuntime = deps.validateActiveRuntime ?? validateActiveRuntimePointer;
  const runtimePlatform = input.platform ?? (osPlatform() as NodeJS.Platform);
  const runtimeArch = input.arch ?? (osArch() as NodeJS.Architecture);
  const preloadPath = fileURLToPath(new URL("./preload.mjs", input.importMetaUrl));
  const windowModule =
    deps.createMainWindow && deps.loadDesktopUrl ? null : await loadWindowModule();
  const createWindow = deps.createMainWindow ?? windowModule?.createMainWindow;
  const loadUrl = deps.loadDesktopUrl ?? windowModule?.loadDesktopUrl;
  const showError =
    deps.showErrorPage ??
    ((window: CreateWindowLike, model: DesktopErrorPageModel) =>
      showDesktopErrorPage(window as never, model));
  const resolveSidecarPaths = deps.createSidecarPaths ?? createSidecarPaths;
  const startSidecar = deps.startDesktopSidecar ?? startDesktopSidecar;

  if (!createWindow || !loadUrl) {
    throw new Error("Desktop window dependencies are unavailable");
  }

  return {
    createWindow: () => createWindow(preloadPath),
    prepareRuntime: async () => {
      await ensureRuntimeReady({
        target: {
          appVersion: input.app.getVersion(),
          platform: runtimePlatform,
          arch: runtimeArch,
        },
        readActiveRuntime: () => runtimeStore.readActiveRuntime(),
        resolveLatestCompatible: (target) => runtimeReleaseProvider.resolveLatestCompatible(target),
        installRelease: (release) => runtimeInstaller.installRelease(release),
        validateActiveRuntime,
      });
    },
    startSidecar: async (): Promise<StartedSidecarLike> => {
      const paths = resolveSidecarPaths({
        isPackaged: input.app.isPackaged,
        resourcesPath: input.resourcesPath,
        appPath: input.app.getAppPath(),
        userDataDir,
      });

      return startSidecar({
        paths,
        stateDir: desktopConfig.stateDir,
        hostOverride: desktopConfig.hostOverride,
        portOverride: desktopConfig.portOverride,
        password: desktopConfig.password,
        appVersion: input.app.getVersion(),
      });
    },
    loadDesktopUrl: loadUrl,
    showErrorPage: showError,
    createUpdateBridge: ({ getSidecar, restartSidecar }: UpdateBridgeFactoryInput) =>
      new DesktopUpdateBridge({
        getSidecar,
        restartSidecar,
        runtimeReleaseProvider: runtimeReleaseProvider,
        runtimeInstaller,
        releaseTarget: {
          appVersion: input.app.getVersion(),
          platform: runtimePlatform,
          arch: runtimeArch,
        },
      }),
  };
}

export async function createDesktopAppController(
  input: StartupInput,
  deps: StartupDeps = {}
): Promise<DesktopAppController> {
  return new DesktopAppController(await buildDesktopControllerDeps(input, deps));
}
