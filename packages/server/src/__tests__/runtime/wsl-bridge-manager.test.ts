import { describe, expect, it, vi } from "vitest";
import { createWslBridgeManager } from "../../runtime/wsl-bridge-manager.js";

describe("wsl bridge manager", () => {
  it("reuses one bridge per distro", async () => {
    const createBridge = vi.fn(async ({ distro, hostRuntimeVersion }) => ({
      id: `bridge:${distro}`,
      runtimeVersion: hostRuntimeVersion,
      stop: vi.fn(async () => {}),
    }));
    const manager = createWslBridgeManager({
      createBridge,
      getHostRuntimeVersion: () => "0.5.6",
    });

    const first = await manager.ensureBridgeForDistro("Ubuntu-24.04");
    const second = await manager.ensureBridgeForDistro("Ubuntu-24.04");

    expect(first).toBe(second);
    expect(createBridge).toHaveBeenCalledTimes(1);
  });

  it("stops and recreates a running bridge when the host runtime version changes", async () => {
    let hostRuntimeVersion = "0.5.5";
    const initialStop = vi.fn(async () => {});
    const replacementStop = vi.fn(async () => {});
    const createBridge = vi.fn(async ({ distro, hostRuntimeVersion: requestedVersion }) => ({
      id: `bridge:${distro}:${requestedVersion}`,
      runtimeVersion: requestedVersion,
      stop: requestedVersion === "0.5.5" ? initialStop : replacementStop,
    }));
    const manager = createWslBridgeManager({
      createBridge,
      getHostRuntimeVersion: () => hostRuntimeVersion,
    });

    const initial = await manager.ensureBridgeForDistro("Ubuntu-24.04");
    hostRuntimeVersion = "0.5.6";

    await manager.reconcileOnHostRuntimeUpdate();

    const replacement = await manager.ensureBridgeForDistro("Ubuntu-24.04");
    expect(initialStop).toHaveBeenCalledTimes(1);
    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(replacement).not.toBe(initial);
    expect(replacement.runtimeVersion).toBe("0.5.6");
    expect(replacement.stop).toBe(replacementStop);
  });

  it("verifies runtime alignment and managed node readiness before starting a bridge", async () => {
    const ensureRuntimeVersion = vi.fn(async () => {});
    const ensureManagedNode = vi.fn(async () => ({
      nodeVersion: "20.11.1",
      nodePath: "/home/me/.coder-studio/node/20.11.1/bin/node",
    }));
    const createBridge = vi.fn(async ({ distro, hostRuntimeVersion, managedNode }) => ({
      id: `bridge:${distro}`,
      runtimeVersion: hostRuntimeVersion,
      nodeVersion: managedNode?.nodeVersion,
      stop: vi.fn(async () => {}),
    }));
    const manager = createWslBridgeManager({
      createBridge,
      ensureManagedNode,
      ensureRuntimeVersion,
      getHostRuntimeVersion: () => "0.5.6",
    });

    await manager.ensureBridgeForDistro("Ubuntu-24.04");

    expect(ensureRuntimeVersion).toHaveBeenCalledWith({
      distro: "Ubuntu-24.04",
      hostRuntimeVersion: "0.5.6",
    });
    expect(ensureManagedNode).toHaveBeenCalledWith({
      distro: "Ubuntu-24.04",
      hostRuntimeVersion: "0.5.6",
    });
    expect(createBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        distro: "Ubuntu-24.04",
        hostRuntimeVersion: "0.5.6",
        managedNode: expect.objectContaining({
          nodeVersion: "20.11.1",
        }),
      })
    );
  });

  it("stops all tracked bridges during shutdown only once", async () => {
    const ubuntuStop = vi.fn(async () => {});
    const debianStop = vi.fn(async () => {});
    const createBridge = vi
      .fn()
      .mockResolvedValueOnce({
        id: "bridge:Ubuntu-24.04",
        runtimeVersion: "0.5.6",
        stop: ubuntuStop,
      })
      .mockResolvedValueOnce({
        id: "bridge:Debian",
        runtimeVersion: "0.5.6",
        stop: debianStop,
      });
    const manager = createWslBridgeManager({
      createBridge,
      getHostRuntimeVersion: () => "0.5.6",
    });

    await manager.ensureBridgeForDistro("Ubuntu-24.04");
    await manager.ensureBridgeForDistro("Debian");

    await manager.stopAllTrackedBridges();
    await manager.stopAllTrackedBridges();

    expect(ubuntuStop).toHaveBeenCalledTimes(1);
    expect(debianStop).toHaveBeenCalledTimes(1);
  });
});
