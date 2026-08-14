import { describe, expect, it, vi } from "vitest";
import {
  DesktopAuthRecoveryCoordinator,
  isDesktopNetworkService,
} from "./desktop-auth-recovery.js";

describe("Desktop authentication recovery", () => {
  it("recognizes Electron Network Service exits without matching unrelated utility processes", () => {
    expect(
      isDesktopNetworkService({
        type: "Utility",
        serviceName: "network.mojom.NetworkService",
      })
    ).toBe(true);
    expect(isDesktopNetworkService({ type: "Utility", name: "Network Service" })).toBe(true);
    expect(isDesktopNetworkService({ type: "Utility", name: "Audio Service" })).toBe(false);
    expect(isDesktopNetworkService({ type: "GPU", name: "Network Service" })).toBe(false);
  });

  it("coalesces concurrent recovery requests and notifies once", async () => {
    let finishAuthentication: (() => void) | undefined;
    const authenticate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAuthentication = resolve;
        })
    );
    const onRecovered = vi.fn();
    const coordinator = new DesktopAuthRecoveryCoordinator({
      canRecover: () => true,
      authenticate,
      onRecovered,
      retryDelaysMs: [],
    });

    const first = coordinator.recover();
    const second = coordinator.recover();
    expect(first).toBe(second);
    expect(authenticate).toHaveBeenCalledTimes(1);

    finishAuthentication?.();
    await expect(first).resolves.toBe(true);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("retries transient authentication failures before notifying the renderer", async () => {
    const authenticate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network service restarting"))
      .mockResolvedValueOnce(undefined);
    const onRecovered = vi.fn();
    const onAttemptFailure = vi.fn();
    const wait = vi.fn(async () => undefined);
    const coordinator = new DesktopAuthRecoveryCoordinator({
      canRecover: () => true,
      authenticate,
      onRecovered,
      onAttemptFailure,
      retryDelaysMs: [250],
      wait,
    });

    await expect(coordinator.recover()).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
    expect(onAttemptFailure).toHaveBeenCalledWith(expect.any(Error), 1, true);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the Desktop environment begins shutting down", async () => {
    let recoverable = true;
    const authenticate = vi.fn(async () => {
      recoverable = false;
      throw new Error("shutting down");
    });
    const onRecovered = vi.fn();
    const coordinator = new DesktopAuthRecoveryCoordinator({
      canRecover: () => recoverable,
      authenticate,
      onRecovered,
      retryDelaysMs: [250, 1_000],
      wait: vi.fn(async () => undefined),
    });

    await expect(coordinator.recover()).resolves.toBe(false);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
