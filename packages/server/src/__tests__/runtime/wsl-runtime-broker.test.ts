import { describe, expect, it, vi } from "vitest";
import { createRuntimeOrchestrator } from "../../host/runtime-orchestrator.js";
import { RuntimeRegistry } from "../../host/runtime-registry.js";
import { WorkspaceRuntimeBindingStore } from "../../host/workspace-runtime-binding.js";
import type { RuntimeHandle } from "../../runtime/contract.js";
import type { WslBridgeManager } from "../../runtime/wsl-bridge-manager.js";
import { createBrokeredWslRuntime } from "../../runtime/wsl-runtime.js";

function createRuntimeHandle(id: string, attachWorkspace = vi.fn(async () => {})): RuntimeHandle {
  return {
    id,
    kind: "wsl",
    summary: {
      scope: "distro-bridge",
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      runtimeVersion: "0.5.6",
      nodeVersion: "20.11.1",
      pid: 4242,
      uptimeMs: 10,
      activeWorkspaceIds: ["ws-1"],
    },
    execute: vi.fn(async () => ({})),
    disposeWorkspace: vi.fn(async () => {}),
    health: vi.fn(async () => ({ ok: true as const })),
    attachWorkspace,
  };
}

describe("brokered wsl runtime startup", () => {
  it("reuses one distro bridge runtime for multiple workspaces in the same distro", async () => {
    const runtime = createRuntimeHandle("wsl:distro:Ubuntu-24.04");
    const createWslRuntime = vi.fn(async () => runtime);
    const bindings = new WorkspaceRuntimeBindingStore();
    const orchestrator = createRuntimeOrchestrator({
      runtimeRegistry: new RuntimeRegistry(),
      bindings,
      workspaceLookup: {
        get: () => undefined,
      },
      nativeRuntimeId: "native-default",
      createWslRuntime,
    });

    await orchestrator.ensureRuntimeForWorkspace({
      id: "ws-1",
      path: "/home/me/app-1",
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    });
    await orchestrator.ensureRuntimeForWorkspace({
      id: "ws-2",
      path: "/home/me/app-2",
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      openedAt: 2,
      lastActiveAt: 2,
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    });

    expect(createWslRuntime).toHaveBeenCalledTimes(1);
    expect(bindings.getRuntimeIdForWorkspace("ws-1")).toBe("wsl:distro:Ubuntu-24.04");
    expect(bindings.getRuntimeIdForWorkspace("ws-2")).toBe("wsl:distro:Ubuntu-24.04");
    expect(runtime.attachWorkspace).toHaveBeenNthCalledWith(1, "ws-1");
    expect(runtime.attachWorkspace).toHaveBeenNthCalledWith(2, "ws-2");
  });

  it("asks the broker for the distro bridge before serving a WSL workspace", async () => {
    const attachWorkspace = vi.fn(async () => {});
    const runtimeHandle = createRuntimeHandle("wsl:distro:Ubuntu-24.04", attachWorkspace);
    const ensureBridgeForDistro = vi.fn(async () => ({
      id: "wsl:distro:Ubuntu-24.04",
      runtimeVersion: "0.5.6",
      nodeVersion: "20.11.1",
      runtimeHandle,
    }));
    const bridgeManager = {
      ensureBridgeForDistro,
      reconcileOnHostRuntimeUpdate: vi.fn(async () => {}),
      stopAllTrackedBridges: vi.fn(async () => {}),
      getTrackedBridge: vi.fn(),
    } satisfies WslBridgeManager;

    const runtime = await createBrokeredWslRuntime({
      bridgeManager,
      runtimeId: "wsl:distro:Ubuntu-24.04",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });

    expect(ensureBridgeForDistro).toHaveBeenCalledWith("Ubuntu-24.04");
    expect(attachWorkspace).toHaveBeenCalledWith("ws-1");
    expect(runtime).toBe(runtimeHandle);
  });

  it("surfaces broker version mismatch failures during startup", async () => {
    const bridgeManager = {
      ensureBridgeForDistro: vi.fn(async () => {
        throw new Error(
          "WSL bridge runtime version mismatch for distro Ubuntu-24.04: expected 0.5.6, got 0.5.5"
        );
      }),
      reconcileOnHostRuntimeUpdate: vi.fn(async () => {}),
      stopAllTrackedBridges: vi.fn(async () => {}),
      getTrackedBridge: vi.fn(),
    } satisfies WslBridgeManager;

    await expect(
      createBrokeredWslRuntime({
        bridgeManager,
        runtimeId: "wsl:distro:Ubuntu-24.04",
        workspace: {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: {
            leftPanelWidth: 250,
            bottomPanelHeight: 200,
            focusMode: false,
          },
        },
      })
    ).rejects.toThrow("expected 0.5.6, got 0.5.5");
  });
});
