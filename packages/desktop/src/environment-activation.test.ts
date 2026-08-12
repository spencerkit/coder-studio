import { describe, expect, it, vi } from "vitest";
import { EnvironmentActivationCoordinator } from "./environment-activation.js";

function createCoordinator() {
  const focusWindow = vi.fn(() => true);
  const markReady = vi.fn(async (_requestId: string) => undefined);
  const markFailed = vi.fn(async (_requestId: string, _message: string) => undefined);
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

  it("waits for a successful acknowledgement before failing pending requests", async () => {
    let releaseAcknowledgement: (() => void) | undefined;
    const markReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAcknowledgement = resolve;
        })
    );
    const markFailed = vi.fn(async () => undefined);
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady,
    });
    await coordinator.markWindowReady();

    const readyRequest = coordinator.request("request-1");
    const failureRequest = coordinator.failPending("Target startup failed");
    const failuresBeforeReadySettled = markFailed.mock.calls.length;
    releaseAcknowledgement?.();
    await readyRequest;
    await failureRequest;

    expect(failuresBeforeReadySettled).toBe(0);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("fails a request only after its in-progress acknowledgement rejects", async () => {
    const acknowledgementError = new Error("Acknowledgement failed");
    let rejectAcknowledgement: ((reason: Error) => void) | undefined;
    const markReady = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAcknowledgement = reject;
        })
    );
    const markFailed = vi.fn(async () => undefined);
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady,
    });
    await coordinator.markWindowReady();

    const readyRequest = coordinator.request("request-1");
    const readyOutcome = expect(readyRequest).rejects.toBe(acknowledgementError);
    const failureRequest = coordinator.failPending("Target startup failed");
    const failuresBeforeReadySettled = markFailed.mock.calls.length;
    rejectAcknowledgement?.(acknowledgementError);
    await readyOutcome;
    await failureRequest;

    expect(failuresBeforeReadySettled).toBe(0);
    expect(markFailed).toHaveBeenCalledOnce();
    expect(markFailed).toHaveBeenCalledWith("request-1", "Target startup failed");
  });

  it("settles every failure callback and retains only rejected requests for retry", async () => {
    const failureError = new Error("Failure acknowledgement failed");
    let releaseSecondFailure: (() => void) | undefined;
    let firstRequestAttempts = 0;
    const markFailed = vi.fn((requestId: string) => {
      if (requestId === "request-1" && firstRequestAttempts++ === 0) {
        return Promise.reject(failureError);
      }
      if (requestId === "request-2") {
        return new Promise<void>((resolve) => {
          releaseSecondFailure = resolve;
        });
      }
      return Promise.resolve();
    });
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady: vi.fn(async () => undefined),
    });
    await coordinator.request("request-1");
    await coordinator.request("request-2");

    let firstFailureSettled = false;
    let observedFailure: unknown;
    const firstFailure = coordinator.failPending("Target startup failed").catch((error) => {
      firstFailureSettled = true;
      observedFailure = error;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeSecondFailure = firstFailureSettled;
    releaseSecondFailure?.();
    await firstFailure;

    expect(settledBeforeSecondFailure).toBe(false);
    expect(observedFailure).toBe(failureError);
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-1")).toHaveLength(
      1
    );
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );

    await coordinator.failPending("Retry startup failure");

    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-1")).toHaveLength(
      2
    );
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );
  });

  it("fails a request added after the active failure batch snapshots pending ids", async () => {
    let releaseFirstFailure: (() => void) | undefined;
    let releaseSecondFailure: (() => void) | undefined;
    const markFailed = vi.fn(
      (requestId: string) =>
        new Promise<void>((resolve) => {
          if (requestId === "request-1") {
            releaseFirstFailure = resolve;
          } else {
            releaseSecondFailure = resolve;
          }
        })
    );
    const markReady = vi.fn(async () => undefined);
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady,
    });
    await coordinator.request("request-1");

    const firstFailure = coordinator.failPending("Target startup failed");
    await Promise.resolve();
    expect(markFailed).toHaveBeenCalledWith("request-1", "Target startup failed");

    let secondRequestSettled = false;
    const secondRequest = coordinator.request("request-2").then(() => {
      secondRequestSettled = true;
    });
    releaseFirstFailure?.();
    await firstFailure;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const secondRequestSettledBeforeFailure = secondRequestSettled;
    releaseSecondFailure?.();
    await secondRequest;

    expect(secondRequestSettledBeforeFailure).toBe(false);
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-1")).toHaveLength(
      1
    );
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );
    expect(markReady).not.toHaveBeenCalled();
  });

  it("keeps duplicate late failure requests pending until their acknowledgement settles", async () => {
    let releaseFirstFailure: (() => void) | undefined;
    let releaseSecondFailure: (() => void) | undefined;
    const markFailed = vi.fn(
      (requestId: string) =>
        new Promise<void>((resolve) => {
          if (requestId === "request-1") {
            releaseFirstFailure = resolve;
          } else {
            releaseSecondFailure = resolve;
          }
        })
    );
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady: vi.fn(async () => undefined),
    });
    await coordinator.request("request-1");

    const firstFailure = coordinator.failPending("Target startup failed");
    await Promise.resolve();
    expect(markFailed).toHaveBeenCalledWith("request-1", "Target startup failed");

    let secondRequestSettled = false;
    let duplicateRequestSettled = false;
    const secondRequest = coordinator.request("request-2").then(() => {
      secondRequestSettled = true;
    });
    const duplicateRequest = coordinator.request("request-2").then(() => {
      duplicateRequestSettled = true;
    });
    releaseFirstFailure?.();
    await firstFailure;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(markFailed).toHaveBeenCalledWith("request-2", "Target startup failed");
    expect(secondRequestSettled).toBe(false);
    expect(duplicateRequestSettled).toBe(false);

    releaseSecondFailure?.();
    await Promise.all([secondRequest, duplicateRequest]);

    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );
  });

  it("shares a late failure rejection across duplicate requests without retrying", async () => {
    const failureError = new Error("Failure acknowledgement failed");
    let releaseFirstFailure: (() => void) | undefined;
    let secondRequestAttempts = 0;
    const markFailed = vi.fn((requestId: string) => {
      if (requestId === "request-1") {
        return new Promise<void>((resolve) => {
          releaseFirstFailure = resolve;
        });
      }
      if (secondRequestAttempts++ === 0) return Promise.reject(failureError);
      return Promise.resolve();
    });
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow: vi.fn(() => true),
      markFailed,
      markReady: vi.fn(async () => undefined),
    });
    await coordinator.request("request-1");

    const firstFailure = coordinator.failPending("Target startup failed");
    await Promise.resolve();

    const secondRequest = coordinator.request("request-2");
    const duplicateRequest = coordinator.request("request-2");
    const secondOutcome = expect(secondRequest).rejects.toBe(failureError);
    const duplicateOutcome = expect(duplicateRequest).rejects.toBe(failureError);
    releaseFirstFailure?.();

    await firstFailure;
    await Promise.all([secondOutcome, duplicateOutcome]);

    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );
  });

  it("fails requests received after startup failure handling completes", async () => {
    const { coordinator, markFailed, markReady } = createCoordinator();
    await coordinator.request("request-1");
    await coordinator.failPending("Target startup failed");

    await coordinator.request("request-2");

    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-1")).toHaveLength(
      1
    );
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      1
    );
    expect(markReady).not.toHaveBeenCalled();
  });

  it("resumes ready acknowledgements after window readiness clears startup failure", async () => {
    const { coordinator, focusWindow, markFailed, markReady } = createCoordinator();
    await coordinator.request("request-1");
    await coordinator.failPending("Target startup failed");

    await coordinator.markWindowReady();
    focusWindow.mockClear();
    markReady.mockClear();

    await coordinator.request("request-2");

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-2");
    expect(markFailed.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(
      0
    );
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

  it("drains a new request after an in-progress acknowledgement rejects", async () => {
    const acknowledgementError = new Error("Acknowledgement failed");
    let rejectFirstAcknowledgement: ((reason: Error) => void) | undefined;
    let firstRequestAttempts = 0;
    const focusWindow = vi.fn(() => true);
    const markReady = vi.fn((requestId: string) => {
      if (requestId === "request-1" && firstRequestAttempts++ === 0) {
        return new Promise<void>((_resolve, reject) => {
          rejectFirstAcknowledgement = reject;
        });
      }
      return Promise.resolve();
    });
    const coordinator = new EnvironmentActivationCoordinator({
      focusWindow,
      markFailed: vi.fn(async () => undefined),
      markReady,
    });
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    const firstRequest = coordinator.request("request-1");
    const secondRequest = coordinator.request("request-2");
    const firstOutcome = expect(firstRequest).rejects.toBe(acknowledgementError);
    const secondOutcome = expect(secondRequest).resolves.toBeUndefined();
    rejectFirstAcknowledgement?.(acknowledgementError);

    await firstOutcome;
    await secondOutcome;

    expect(focusWindow).toHaveBeenCalledTimes(2);
    expect(markReady.mock.calls.filter(([requestId]) => requestId === "request-1")).toHaveLength(2);
    expect(markReady.mock.calls.filter(([requestId]) => requestId === "request-2")).toHaveLength(1);
  });
});
