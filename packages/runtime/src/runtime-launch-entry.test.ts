import { afterEach, describe, expect, it, vi } from "vitest";

const { createServer } = vi.hoisted(() => ({
  createServer: vi.fn(),
}));

const { buildWslRuntimeSource } = vi.hoisted(() => ({
  buildWslRuntimeSource: vi.fn(({ runtimeVersion, packageRoot, entryRelativePath }) => ({
    runtimeVersion,
    packageRoot,
    entryPath: `${packageRoot}/${entryRelativePath ?? "dist/wsl-runtime-entry.mjs"}`,
  })),
}));

vi.mock("@coder-studio/server", () => ({
  createServer,
  normalizeDesktopUpdateStatePatch: (value: unknown) => value,
  type: {},
}));

const { existsSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync,
  readFileSync,
}));

vi.mock("./wsl-runtime-source.js", () => ({
  buildWslRuntimeSource,
}));

import {
  buildDesktopRuntimeServerConfig,
  main,
  parseDesktopRuntimeEnv,
} from "./runtime-launch-entry.js";

describe("runtime-launch-entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("parses desktop-specific runtime env overrides", () => {
    expect(
      parseDesktopRuntimeEnv({
        CODER_STUDIO_DESKTOP_HOST: "0.0.0.0",
        CODER_STUDIO_DESKTOP_PORT: "0",
        CODER_STUDIO_DESKTOP_STATE_DIR: "/tmp/cs-state",
        CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
        CODER_STUDIO_DESKTOP_PASSWORD: "sekrit",
        CODER_STUDIO_DESKTOP_APP_VERSION: "1.2.3-app",
        CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "1.2.3-runtime",
        CODER_STUDIO_DESKTOP_WEB_ROOT: "/tmp/web",
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 0,
      stateDir: "/tmp/cs-state",
      runtimeJsonPath: "/tmp/runtime.json",
      password: "sekrit",
      appVersion: "1.2.3-app",
      runtimeVersion: "1.2.3-runtime",
      webRoot: "/tmp/web",
    });
  });

  it("builds desktop-managed server config without CLI update defaults", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    existsSync.mockImplementation((path: string) => path === "/tmp/web");

    const result = buildDesktopRuntimeServerConfig(
      {
        CODER_STUDIO_DESKTOP_PORT: "43123",
        CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
        CODER_STUDIO_DESKTOP_WEB_ROOT: "/tmp/web",
        CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "0.5.4",
      },
      "file:///repo/packages/runtime/dist/esm/runtime-launch-entry.mjs"
    );

    expect(result).toEqual({
      serverConfig: {
        port: 43123,
        appVersion: "0.5.4",
        runtimeVersion: "0.5.4",
        wslRuntime: {
          enabled: true,
          source: expect.objectContaining({
            runtimeVersion: "0.5.4",
            entryPath: expect.stringContaining("wsl-runtime-entry"),
          }),
        },
        webRoot: "/tmp/web",
        update: {
          supported: true,
          installKind: "desktop_managed",
          packageName: "@spencer-kit/coder-studio",
          cliCommand: "coder-studio",
          npmCommand: "npm",
          restartArgs: [],
          installArgsPrefix: [],
          unsupportedReason: null,
        },
      },
      runtimeJsonPath: "/tmp/runtime.json",
      writeRuntimeConfig: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("starts the server with explicit runtime-config writing enabled", async () => {
    const stop = vi.fn(async () => {});
    createServer.mockResolvedValue({ stop });

    await main({
      CODER_STUDIO_DESKTOP_PORT: "0",
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
      CODER_STUDIO_DESKTOP_WEB_ROOT: "/tmp/web",
      CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "0.5.4",
    });

    expect(createServer).toHaveBeenCalledWith({
      port: 0,
      appVersion: "0.5.4",
      runtimeVersion: "0.5.4",
      wslRuntime: {
        enabled: true,
        source: expect.objectContaining({
          runtimeVersion: "0.5.4",
        }),
      },
      webRoot: "/tmp/web",
      update: {
        supported: true,
        installKind: "desktop_managed",
        packageName: "@spencer-kit/coder-studio",
        cliCommand: "coder-studio",
        npmCommand: "npm",
        restartArgs: [],
        installArgsPrefix: [],
        unsupportedReason: null,
      },
      runtimeJsonPath: "/tmp/runtime.json",
      writeRuntimeConfig: true,
      desktopUpdateAdapter: expect.objectContaining({
        startInstall: expect.any(Function),
        bindStateController: expect.any(Function),
      }),
    });
  });

  it("binds a desktop update adapter that forwards process messages into the state controller", async () => {
    const stop = vi.fn(async () => {});
    createServer.mockResolvedValue({ stop });
    const processOn = vi.spyOn(process, "on");

    await main({
      CODER_STUDIO_DESKTOP_PORT: "0",
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
      CODER_STUDIO_DESKTOP_WEB_ROOT: "/tmp/web",
      CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "0.5.4",
    });

    const serverCall = createServer.mock.calls.at(-1)?.[0] as {
      desktopUpdateAdapter?: {
        bindStateController(controller: { applyPatch(patch: Record<string, unknown>): void }): void;
      };
    };
    const applied: Record<string, unknown>[] = [];
    serverCall.desktopUpdateAdapter?.bindStateController({
      applyPatch: (patch) => {
        applied.push(patch);
      },
    });

    const messageHandler = processOn.mock.calls.find(([event]) => event === "message")?.[1] as
      | ((message: unknown) => void)
      | undefined;
    messageHandler?.({
      kind: "desktop-update",
      action: "apply-state-patch",
      payload: {
        updateStatus: "failed",
        errorSummary: "boom",
      },
    });

    expect(applied).toEqual([
      {
        updateStatus: "failed",
        errorSummary: "boom",
      },
    ]);
  });

  it("binds a desktop update adapter that requests latest runtime versions from the host", async () => {
    const stop = vi.fn(async () => {});
    createServer.mockResolvedValue({ stop });
    const processOn = vi.spyOn(process, "on");
    const processSend = vi.spyOn(process, "send").mockReturnValue(true);

    await main({
      CODER_STUDIO_DESKTOP_PORT: "0",
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
      CODER_STUDIO_DESKTOP_WEB_ROOT: "/tmp/web",
      CODER_STUDIO_DESKTOP_RUNTIME_VERSION: "0.5.4",
    });

    const serverCall = createServer.mock.calls.at(-1)?.[0] as {
      desktopUpdateAdapter?: {
        checkForUpdates(input: {
          currentVersion: string;
        }): Promise<{ latestVersion: string | null }>;
      };
    };

    const checkPromise = serverCall.desktopUpdateAdapter?.checkForUpdates({
      currentVersion: "0.5.4",
    });

    const request = processSend.mock.calls.at(-1)?.[0] as
      | {
          kind?: string;
          action?: string;
          payload?: { requestId?: string };
        }
      | undefined;
    expect(request).toMatchObject({
      kind: "desktop-update",
      action: "check-for-updates",
      payload: expect.objectContaining({
        currentVersion: "0.5.4",
        requestId: expect.any(String),
      }),
    });

    const messageHandler = processOn.mock.calls.find(([event]) => event === "message")?.[1] as
      | ((message: unknown) => void)
      | undefined;
    messageHandler?.({
      kind: "desktop-update",
      action: "check-for-updates-result",
      payload: {
        requestId: request?.payload?.requestId,
        latestVersion: "0.5.5",
      },
    });

    await expect(checkPromise).resolves.toEqual({
      latestVersion: "0.5.5",
    });
  });

  it("falls back to the runtime package version when env version is missing", () => {
    existsSync.mockImplementation((path: string) => path.endsWith("/package.json"));
    readFileSync.mockReturnValue(JSON.stringify({ version: "9.8.7" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = buildDesktopRuntimeServerConfig(
      {
        CODER_STUDIO_DESKTOP_PORT: "0",
      },
      "file:///repo/packages/runtime/dist/esm/runtime-launch-entry.mjs"
    );

    expect(result.serverConfig.appVersion).toBe("9.8.7");
    expect(result.serverConfig.webRoot).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Warning: Desktop web assets not found. Frontend will not be available."
    );
  });
});
