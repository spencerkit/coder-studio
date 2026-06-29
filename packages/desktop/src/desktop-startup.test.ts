import { describe, expect, it, vi } from "vitest";
import { buildDesktopControllerDeps } from "./desktop-startup.js";

describe("desktop-startup", () => {
  const app = {
    isPackaged: true,
    getAppPath: () => "/Applications/Coder Studio.app/Contents/Resources/app.asar",
    getPath: () => "/Users/test/Library/Application Support/Coder Studio",
    getVersion: () => "1.2.3",
  };

  it("skips bootstrap when an active runtime already exists", async () => {
    const readActiveRuntime = vi.fn(async () => ({
      version: "0.5.4",
      installedAt: 1700000000000,
      path: "/tmp/runtime-store/versions/0.5.4",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-054",
      source: "github-release",
    }));
    const resolveLatestCompatible = vi.fn();
    const installRelease = vi.fn();

    const deps = await buildDesktopControllerDeps(
      {
        app,
        importMetaUrl: "file:///repo/packages/desktop/dist/electron/main.mjs",
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
      },
      {
        resolveDesktopLaunchConfig: () => ({
          stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
        }),
        createRuntimeStore: () => ({
          readActiveRuntime,
        }),
        createRuntimeReleaseProvider: () => ({
          resolveLatestCompatible,
          resolveVersion: vi.fn(),
        }),
        createRuntimeInstaller: () => ({
          installRelease,
        }),
        validateActiveRuntime: async () => true,
        createMainWindow: vi.fn(),
        loadDesktopUrl: vi.fn(),
        showErrorPage: vi.fn(),
        createSidecarPaths: vi.fn(() => {
          throw new Error("not used");
        }),
        startDesktopSidecar: vi.fn(async () => {
          throw new Error("not used");
        }),
      }
    );

    await deps.prepareRuntime?.();

    expect(readActiveRuntime).toHaveBeenCalledTimes(1);
    expect(resolveLatestCompatible).not.toHaveBeenCalled();
    expect(installRelease).not.toHaveBeenCalled();
  });

  it("bootstraps again when the active runtime pointer is no longer valid", async () => {
    const resolveLatestCompatible = vi.fn(async () => ({
      version: "0.5.6",
      platform: "darwin" as const,
      arch: "arm64" as const,
      artifactUrl: "https://example.com/runtime.zip",
      checksumSha256: "sha-056",
      artifactSize: 5600,
      publishedAt: "2026-06-29T12:00:00.000Z",
    }));
    const installRelease = vi.fn(async () => ({
      version: "0.5.6",
      installedAt: 1700000002234,
      path: "/tmp/runtime-store/versions/0.5.6",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-056",
      source: "github-release",
    }));

    const deps = await buildDesktopControllerDeps(
      {
        app,
        importMetaUrl: "file:///repo/packages/desktop/dist/electron/main.mjs",
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
        platform: "darwin",
        arch: "arm64",
      },
      {
        resolveDesktopLaunchConfig: () => ({
          stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
        }),
        createRuntimeStore: () => ({
          readActiveRuntime: async () => ({
            version: "0.5.4",
            installedAt: 1700000000000,
            path: "/tmp/runtime-store/versions/0.5.4",
            entry: "dist/esm/runtime-launch-entry.mjs",
            webRoot: "dist/web",
            checksumSha256: "sha-054",
            source: "github-release",
          }),
        }),
        createRuntimeReleaseProvider: () => ({
          resolveLatestCompatible,
          resolveVersion: vi.fn(async () => null),
        }),
        createRuntimeInstaller: () => ({
          installRelease,
        }),
        validateActiveRuntime: async () => false,
        createMainWindow: vi.fn(),
        loadDesktopUrl: vi.fn(),
        showErrorPage: vi.fn(),
        createSidecarPaths: vi.fn(() => {
          throw new Error("not used");
        }),
        startDesktopSidecar: vi.fn(async () => {
          throw new Error("not used");
        }),
      }
    );

    await deps.prepareRuntime?.();

    expect(resolveLatestCompatible).toHaveBeenCalledWith({
      appVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    });
    expect(installRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "0.5.6",
      })
    );
  });

  it("bootstraps the latest compatible runtime when no active runtime exists", async () => {
    const resolveLatestCompatible = vi.fn(async () => ({
      version: "0.5.5",
      platform: "darwin" as const,
      arch: "arm64" as const,
      artifactUrl: "https://example.com/runtime.zip",
      checksumSha256: "sha-055",
      artifactSize: 5500,
      publishedAt: "2026-06-28T12:00:00.000Z",
    }));
    const installRelease = vi.fn(async () => ({
      version: "0.5.5",
      installedAt: 1700000001234,
      path: "/tmp/runtime-store/versions/0.5.5",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-055",
      source: "github-release",
    }));

    const deps = await buildDesktopControllerDeps(
      {
        app,
        importMetaUrl: "file:///repo/packages/desktop/dist/electron/main.mjs",
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
        platform: "darwin",
        arch: "arm64",
      },
      {
        resolveDesktopLaunchConfig: () => ({
          stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
        }),
        createRuntimeStore: () => ({
          readActiveRuntime: async () => null,
        }),
        createRuntimeReleaseProvider: () => ({
          resolveLatestCompatible,
          resolveVersion: vi.fn(),
        }),
        createRuntimeInstaller: () => ({
          installRelease,
        }),
        validateActiveRuntime: async () => true,
        createMainWindow: vi.fn(),
        loadDesktopUrl: vi.fn(),
        showErrorPage: vi.fn(),
        createSidecarPaths: vi.fn(() => {
          throw new Error("not used");
        }),
        startDesktopSidecar: vi.fn(async () => {
          throw new Error("not used");
        }),
      }
    );

    await deps.prepareRuntime?.();

    expect(resolveLatestCompatible).toHaveBeenCalledWith({
      appVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    });
    expect(installRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "0.5.5",
      })
    );
  });

  it("passes app and runtime metadata through to sidecar startup", async () => {
    const createSidecarPaths = vi.fn(() => ({
      nodeExecutable: "/bundle/runtime/node/node",
      runtimeEntry: "/bundle/runtime/versions/0.5.5/dist/esm/runtime-launch-entry.mjs",
      runtimeVersion: "0.5.5",
      webRoot: "/bundle/runtime/versions/0.5.5/dist/web",
      runtimeJsonPath: "/Users/test/Library/Application Support/Coder Studio/runtime/runtime.json",
    }));
    const startDesktopSidecar = vi.fn(async () => ({
      browserUrl: "http://127.0.0.1:4173",
      getLogExcerpt: () => "",
      send: () => {},
      stop: async () => {},
      on: () => {},
    }));

    const deps = await buildDesktopControllerDeps(
      {
        app,
        importMetaUrl: "file:///repo/packages/desktop/dist/electron/main.mjs",
        resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
      },
      {
        resolveDesktopLaunchConfig: () => ({
          stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
          hostOverride: "127.0.0.1",
          portOverride: 4173,
          password: "sekrit",
        }),
        createRuntimeStore: () => ({
          readActiveRuntime: async () => ({
            version: "0.5.5",
            installedAt: 1700000001234,
            path: "/tmp/runtime-store/versions/0.5.5",
            entry: "dist/esm/runtime-launch-entry.mjs",
            webRoot: "dist/web",
            checksumSha256: "sha-055",
            source: "github-release",
          }),
        }),
        createRuntimeReleaseProvider: () => ({
          resolveLatestCompatible: vi.fn(),
          resolveVersion: vi.fn(),
        }),
        createRuntimeInstaller: () => ({
          installRelease: vi.fn(),
        }),
        validateActiveRuntime: async () => true,
        createMainWindow: vi.fn(),
        loadDesktopUrl: vi.fn(),
        showErrorPage: vi.fn(),
        createSidecarPaths,
        startDesktopSidecar,
      }
    );

    await deps.startSidecar();

    expect(createSidecarPaths).toHaveBeenCalledWith({
      isPackaged: true,
      resourcesPath: "/Applications/Coder Studio.app/Contents/Resources",
      appPath: "/Applications/Coder Studio.app/Contents/Resources/app.asar",
      userDataDir: "/Users/test/Library/Application Support/Coder Studio",
    });
    expect(startDesktopSidecar).toHaveBeenCalledWith({
      paths: {
        nodeExecutable: "/bundle/runtime/node/node",
        runtimeEntry: "/bundle/runtime/versions/0.5.5/dist/esm/runtime-launch-entry.mjs",
        runtimeVersion: "0.5.5",
        webRoot: "/bundle/runtime/versions/0.5.5/dist/web",
        runtimeJsonPath:
          "/Users/test/Library/Application Support/Coder Studio/runtime/runtime.json",
      },
      stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
      hostOverride: "127.0.0.1",
      portOverride: 4173,
      password: "sekrit",
      appVersion: "1.2.3",
    });
  });
});
