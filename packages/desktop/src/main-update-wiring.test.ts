import { describe, expect, it, vi } from "vitest";
import { registerDesktopUpdateIpc, toLegacyRuntimeUpdateState } from "./desktop-update-ipc.js";

const state = {
  schemaVersion: 1 as const,
  runtimeContext: {
    environment: "desktop-native" as const,
    authority: "desktop" as const,
    supported: true,
    unsupportedReason: null,
  },
  status: "ready" as const,
  productVersion: "0.5.0",
  productPublishedAt: "2026-07-01T00:00:00.000Z",
  planId: "plan-1",
  createdAt: "2026-08-08T01:00:00.000Z",
  updatedAt: "2026-08-08T02:00:00.000Z",
  lastCheckedAt: 123,
  components: [
    {
      id: "runtime:win32-x64" as const,
      kind: "runtime" as const,
      target: "win32-x64" as const,
      currentVersion: "0.5.0",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      targetVersion: "0.6.0",
      targetPublishedAt: "2026-08-08T01:02:03.000Z",
      status: "ready" as const,
      progressPercent: 100,
      downloaded: true,
      verified: true,
      errorSummary: null,
    },
  ],
  compatibility: { compatible: true, code: null, summary: null },
  diagnostics: {
    failedComponentId: null,
    failedPhase: null,
    shellVersion: "0.3.0",
    shellPublishedAt: "2026-08-08T01:02:03.000Z",
    shellBuiltAt: "2026-08-08T01:02:03.000Z",
    engineVersion: "2",
    nodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    logLocations: [],
    recoveryAction: null,
  },
  restartRequired: true,
  requiresManualStep: false,
  manualCommand: null,
  errorSummary: null,
};

describe("unified Desktop update IPC", () => {
  it("registers one unified surface and delegates legacy Runtime calls", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    const coordinator = {
      getState: vi.fn(() => state),
      check: vi.fn(async () => state),
      download: vi.fn(async () => state),
      retryFailed: vi.fn(async () => state),
      cancelDownload: vi.fn(() => state),
      prepareRestart: vi.fn(async () => state),
      restartAndInstall: vi.fn(async () => true),
      getSettings: vi.fn(async () => ({
        schemaVersion: 1 as const,
        autoCheckEnabled: true,
        checkIntervalSec: 21600 as const,
      })),
      setSettings: vi.fn(async () => ({
        schemaVersion: 1 as const,
        autoCheckEnabled: true,
        checkIntervalSec: 21600 as const,
      })),
    };
    registerDesktopUpdateIpc({
      ipc: ipc as never,
      getCoordinator: () => coordinator as never,
      getFallbackState: () => state,
    });

    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        "desktop:get-update-state",
        "desktop:check-for-updates",
        "desktop:download-update",
        "desktop:retry-update",
        "desktop:cancel-update-download",
        "desktop:prepare-update-restart",
        "desktop:restart-and-install-update",
        "desktop:get-update-settings",
        "desktop:set-update-settings",
      ])
    );
    await handlers.get("desktop:check-runtime-update")?.({});
    expect(coordinator.check).toHaveBeenCalledWith({ manual: true });
    expect(handlers.get("desktop:get-runtime-update-state")?.({})).toMatchObject({
      status: "ready",
      pendingVersion: "0.6.0",
    });
  });

  it("maps component versions into the legacy compatibility view", () => {
    expect(toLegacyRuntimeUpdateState(state)).toEqual({
      supported: true,
      currentVersion: "0.5.0",
      latestVersion: "0.6.0",
      pendingVersion: "0.6.0",
      lastCheckedAt: 123,
      status: "ready",
      errorSummary: null,
      unsupportedReason: null,
    });
  });
});
