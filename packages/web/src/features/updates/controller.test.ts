import type {
  DesktopUpdateSettings,
  ProductUpdateState,
  UpdatePrepareInstallResponse,
  UpdateRuntimeContext,
  UpdateStateView,
} from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { createUpdateController } from "./controller";
import type { DesktopUpdateBridge, UpdateCommandDispatcher } from "./types";

const noActiveWork = {
  runningTerminalCount: 0,
  runningSessionCount: 0,
  runningSupervisorCount: 0,
  hasActiveWork: false,
};

function serverState(runtimeContext: UpdateRuntimeContext): UpdateStateView {
  return {
    version: 2,
    currentVersion: "0.5.0",
    currentPublishedAt: "2026-08-01T00:00:00.000Z",
    latestVersion: "0.6.0",
    latestPublishedAt: "2026-08-08T00:00:00.000Z",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 123,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: runtimeContext.supported,
    installKind: runtimeContext.environment === "cli-global-npm" ? "global_npm" : "unsupported",
    unsupportedReason: runtimeContext.unsupportedReason,
    runtimeContext,
  };
}

const desktopManagedServer = serverState({
  environment: "desktop-managed",
  authority: "desktop",
  supported: false,
  unsupportedReason: "Managed by Coder Studio Desktop",
});
const cliAvailableState = serverState({
  environment: "cli-global-npm",
  authority: "cli",
  supported: true,
  unsupportedReason: null,
});
const unsupportedCliServer = serverState({
  environment: "cli-unsupported",
  authority: "none",
  supported: false,
  unsupportedReason: "Not installed from npm",
});

function productState(environment: "desktop-native" | "desktop-wsl"): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext: { environment, authority: "desktop", supported: true, unsupportedReason: null },
    status: "available",
    productVersion: "0.5.0",
    productPublishedAt: "2026-08-01T00:00:00.000Z",
    planId: "plan-1",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    lastCheckedAt: 123,
    components: [],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: "0.5.0",
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: null,
    },
    restartRequired: false,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}

function desktopBridge(
  environment: "desktop-native" | "desktop-wsl" = "desktop-native"
): DesktopUpdateBridge {
  let state = productState(environment);
  const settings: DesktopUpdateSettings = {
    schemaVersion: 1,
    autoCheckEnabled: true,
    checkIntervalSec: 21600,
  };
  return {
    updateApiVersion: 1,
    getUpdateState: vi.fn(async () => state),
    checkForUpdates: vi.fn(async () => state),
    downloadUpdate: vi.fn(async () => state),
    retryUpdate: vi.fn(async () => state),
    cancelUpdateDownload: vi.fn(async () => state),
    prepareUpdateRestart: vi.fn(async () => {
      state = { ...state, status: "ready", restartRequired: true };
      return state;
    }),
    restartAndInstallUpdate: vi.fn(async () => true),
    getUpdateSettings: vi.fn(async () => settings),
    setUpdateSettings: vi.fn(async () => settings),
    onUpdateStateChanged: vi.fn(() => () => {}),
  };
}

function createDispatch(
  overrides: Partial<Record<string, unknown>> = {}
): UpdateCommandDispatcher & ReturnType<typeof vi.fn> {
  const dispatch = vi.fn(async (operation: string) => {
    if (operation in overrides) {
      return { ok: true, data: overrides[operation] };
    }
    if (operation === "updates.prepareInstall") {
      const prepared: UpdatePrepareInstallResponse = {
        ...cliAvailableState,
        canStartInstall: true,
        activity: noActiveWork,
      };
      return { ok: true, data: prepared };
    }
    if (operation === "updates.getState" || operation === "updates.check") {
      return { ok: true, data: cliAvailableState };
    }
    if (operation === "updates.startInstall") {
      return {
        ok: true,
        data: { ...cliAvailableState, updateStatus: "restarting", targetVersion: "0.6.0" },
      };
    }
    return { ok: false, error: { code: "unexpected", message: operation } };
  });
  return dispatch as unknown as UpdateCommandDispatcher & ReturnType<typeof vi.fn>;
}

describe("createUpdateController", () => {
  it.each([
    ["Desktop native", desktopManagedServer, desktopBridge("desktop-native"), "desktop"],
    ["Desktop WSL", desktopManagedServer, desktopBridge("desktop-wsl"), "desktop"],
    ["global CLI", cliAvailableState, undefined, "cli"],
    ["unsupported CLI", unsupportedCliServer, undefined, "readonly"],
    ["external Desktop sidecar", desktopManagedServer, undefined, "readonly"],
    ["Desktop bridge against CLI", cliAvailableState, desktopBridge(), "readonly"],
  ] as const)("resolves %s to %s", async (_name, state, bridge, expectedKind) => {
    const controller = await createUpdateController({
      serverState: state,
      desktopBridge: bridge,
      dispatch: createDispatch(),
    });

    expect(controller.kind).toBe(expectedKind);
    controller.dispose();
  });

  it("uses only unified IPC for Desktop component actions", async () => {
    const bridge = desktopBridge();
    const dispatch = createDispatch();
    const controller = await createUpdateController({
      serverState: desktopManagedServer,
      desktopBridge: bridge,
      dispatch,
    });

    await controller.check();
    await controller.download();
    await controller.retry();

    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.retryUpdate).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalledWith("updates.check", expect.anything(), undefined);
    expect(dispatch).not.toHaveBeenCalledWith("updates.startInstall", expect.anything(), undefined);
    controller.dispose();
  });

  it("preserves the CLI prepare and exact-install command sequence", async () => {
    const dispatch = createDispatch();
    const controller = await createUpdateController({
      serverState: cliAvailableState,
      desktopBridge: undefined,
      dispatch,
    });

    const prepared = await controller.prepare();
    await controller.start(prepared, false);

    expect(dispatch).toHaveBeenNthCalledWith(1, "updates.prepareInstall", {}, undefined);
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      "updates.startInstall",
      {
        targetVersion: "0.6.0",
        force: false,
      },
      undefined
    );
    controller.dispose();
  });

  it("blocks all mutation for an external Desktop sidecar", async () => {
    const dispatch = createDispatch();
    const controller = await createUpdateController({
      serverState: desktopManagedServer,
      desktopBridge: undefined,
      dispatch,
    });

    await expect(controller.check()).rejects.toMatchObject({ code: "update_read_only" });
    expect(dispatch).not.toHaveBeenCalled();
    controller.dispose();
  });
});
