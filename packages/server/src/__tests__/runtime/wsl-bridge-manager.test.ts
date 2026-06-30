import { describe, expect, it, vi } from "vitest";
import { createWslBridgeManager } from "../../runtime/wsl-bridge-manager.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

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
    expect(replacement.stop).toBeTypeOf("function");
  });

  it("deduplicates overlapping reconcile calls for the same stale bridge", async () => {
    let hostRuntimeVersion = "0.5.5";
    const stopBarrier = createDeferred<void>();
    const initialStop = vi.fn(async () => {
      await stopBarrier.promise;
    });
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

    await manager.ensureBridgeForDistro("Ubuntu-24.04");
    hostRuntimeVersion = "0.5.6";

    let secondSettled = false;
    const firstReconcile = manager.reconcileOnHostRuntimeUpdate();
    const secondReconcile = manager.reconcileOnHostRuntimeUpdate().then(() => {
      secondSettled = true;
    });

    await vi.waitFor(() => {
      expect(initialStop).toHaveBeenCalledTimes(1);
    });
    expect(secondSettled).toBe(false);

    stopBarrier.resolve();
    await Promise.all([firstReconcile, secondReconcile]);

    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(manager.getTrackedBridge("Ubuntu-24.04")?.runtimeVersion).toBe("0.5.6");
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

  it("retries failed bridge stops on a later shutdown attempt", async () => {
    const stopError = new Error("failed to stop Ubuntu bridge");
    const ubuntuStop = vi.fn().mockRejectedValueOnce(stopError).mockResolvedValueOnce(undefined);
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

    await expect(manager.stopAllTrackedBridges()).rejects.toThrow(stopError.message);
    expect(ubuntuStop).toHaveBeenCalledTimes(1);
    expect(debianStop).toHaveBeenCalledTimes(1);
    expect(manager.getTrackedBridge("Ubuntu-24.04")).toBeDefined();
    expect(manager.getTrackedBridge("Debian")).toBeUndefined();

    await expect(manager.stopAllTrackedBridges()).resolves.toBeUndefined();
    expect(ubuntuStop).toHaveBeenCalledTimes(2);
    expect(manager.getTrackedBridge("Ubuntu-24.04")).toBeUndefined();
  });

  it("cleans up a mismatched bridge created during ensure", async () => {
    const mismatchedStop = vi.fn(async () => {});
    const manager = createWslBridgeManager({
      createBridge: async ({ distro }) => ({
        id: `bridge:${distro}:0.5.5`,
        runtimeVersion: "0.5.5",
        stop: mismatchedStop,
      }),
      getHostRuntimeVersion: () => "0.5.6",
    });

    await expect(manager.ensureBridgeForDistro("Ubuntu-24.04")).rejects.toThrow(
      "expected 0.5.6, got 0.5.5"
    );
    expect(mismatchedStop).toHaveBeenCalledWith({
      reason: "runtime-version-mismatch",
      nextRuntimeVersion: "0.5.6",
    });
    expect(manager.getTrackedBridge("Ubuntu-24.04")).toBeUndefined();
  });
});
