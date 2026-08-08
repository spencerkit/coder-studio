import { describe, expect, it, vi } from "vitest";
import { EnvironmentActivationCoordinator } from "./environment-activation.js";

function createCoordinator() {
  const focusWindow = vi.fn(() => true);
  const markReady = vi.fn(async () => undefined);
  const markFailed = vi.fn(async () => undefined);
  return {
    coordinator: new EnvironmentActivationCoordinator({ focusWindow, markFailed, markReady }),
    focusWindow,
    markFailed,
    markReady,
  };
}

describe("EnvironmentActivationCoordinator", () => {
  it("queues a request received before window readiness", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();

    await coordinator.request("request-1");
    expect(focusWindow).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();

    await coordinator.markWindowReady();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-1");
  });

  it("focuses and acknowledges immediately after readiness", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    await coordinator.request("request-2");

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-2");
  });

  it("deduplicates repeated startup requests", async () => {
    const { coordinator, markReady } = createCoordinator();

    await coordinator.request("request-1");
    await coordinator.request("request-1");
    await coordinator.markWindowReady();

    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a request while its acknowledgement is in progress", async () => {
    let releaseAcknowledgement: (() => void) | undefined;
    const focusWindow = vi.fn(() => true);
    const markReady = vi
      .fn<(requestId: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseAcknowledgement = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow,
      markFailed: vi.fn(async () => undefined),
      markReady,
    });
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    const firstRequest = coordinator.request("request-1");
    const duplicateRequest = coordinator.request("request-1");
    releaseAcknowledgement?.();
    await Promise.all([firstRequest, duplicateRequest]);

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledOnce();
  });

  it("retains a request after acknowledgement failure for a later retry", async () => {
    const acknowledgementError = new Error("Acknowledgement failed");
    const focusWindow = vi.fn(() => true);
    const markReady = vi
      .fn<(requestId: string) => Promise<void>>()
      .mockRejectedValueOnce(acknowledgementError)
      .mockResolvedValue(undefined);
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow,
      markFailed: vi.fn(async () => undefined),
      markReady,
    });
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    await expect(coordinator.request("request-1")).rejects.toBe(acknowledgementError);

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledOnce();

    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenLastCalledWith("request-1");
  });

  it("queues ordinary focus requests that have no acknowledgement id", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();

    await coordinator.request();
    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).not.toHaveBeenCalled();
  });

  it("fails every pending launch request on startup failure", async () => {
    const { coordinator, markFailed, markReady } = createCoordinator();
    await coordinator.request("request-1");
    await coordinator.request("request-2");

    await coordinator.failPending("Target startup failed");

    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenCalledWith("request-1", "Target startup failed");
    expect(markFailed).toHaveBeenCalledWith("request-2", "Target startup failed");
    expect(markReady).not.toHaveBeenCalled();
  });

  it("keeps requests pending when the window cannot be focused", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();
    focusWindow.mockReturnValueOnce(false).mockReturnValue(true);
    await coordinator.request("request-1");

    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).not.toHaveBeenCalled();

    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-1");
  });

  it("queues requests while a previously ready window is unavailable", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();
    await coordinator.markWindowReady();
    focusWindow.mockClear();
    coordinator.markWindowUnavailable();

    await coordinator.request("request-1");

    expect(focusWindow).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();

    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-1");
  });

  it("flushes requests added while an acknowledgement is in progress", async () => {
    let releaseFirstAcknowledgement: (() => void) | undefined;
    const focusWindow = vi.fn(() => true);
    const markReady = vi.fn((requestId: string) =>
      requestId === "request-1"
        ? new Promise<void>((resolve) => {
            releaseFirstAcknowledgement = resolve;
          })
        : Promise.resolve()
    );
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow,
      markFailed: vi.fn(async () => undefined),
      markReady,
    });
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    const firstRequest = coordinator.request("request-1");
    const secondRequest = coordinator.request("request-2");

    expect(markReady).toHaveBeenCalledTimes(1);
    expect(markReady).toHaveBeenCalledWith("request-1");
    releaseFirstAcknowledgement?.();
    await Promise.all([firstRequest, secondRequest]);

    expect(focusWindow).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenCalledTimes(2);
    expect(markReady).toHaveBeenCalledWith("request-2");
  });
});
