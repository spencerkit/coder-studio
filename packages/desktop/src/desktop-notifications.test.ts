import type { NotificationConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopNotificationService,
  parseDesktopNotificationRequest,
} from "./desktop-notifications.js";

const validRequest = {
  title: "Session completed",
  body: "Codex · workspace · 5s\nReady for your next instruction",
  tag: "session-sess-1-123",
  workspaceId: "ws-1",
  sessionId: "sess-1",
};

class FakeNotification {
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly show = vi.fn();
  readonly close = vi.fn();

  once(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const listener of listeners) listener(...args);
  }
}

function createHarness(overrides: { supported?: boolean } = {}) {
  const notifications: FakeNotification[] = [];
  const createNotification = vi.fn((_options: NotificationConstructorOptions) => {
    const notification = new FakeNotification();
    notifications.push(notification);
    return notification;
  });
  const onClick = vi.fn();
  const onWarning = vi.fn();
  const service = createDesktopNotificationService({
    isSupported: () => overrides.supported ?? true,
    createNotification: createNotification as never,
    onClick,
    onWarning,
    platform: "win32",
    deliveryTimeoutMs: 100,
  });
  return { service, notifications, createNotification, onClick, onWarning };
}

describe("Desktop native notifications", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts only a bounded plain request", () => {
    expect(parseDesktopNotificationRequest(validRequest)).toEqual(validRequest);

    for (const invalid of [
      null,
      [],
      {},
      { ...validRequest, title: "" },
      { ...validRequest, body: 42 },
      { ...validRequest, tag: "x".repeat(129) },
      { ...validRequest, workspaceId: "x".repeat(257) },
      { ...validRequest, sessionId: "   " },
    ]) {
      expect(parseDesktopNotificationRequest(invalid)).toBeNull();
    }
  });

  it("reports unsupported without constructing a native notification", async () => {
    const { service, createNotification } = createHarness({ supported: false });

    await expect(service.show(validRequest)).resolves.toEqual({ status: "unsupported" });
    expect(service.isSupported()).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("constructs a silent native notification from validated fields", async () => {
    const { service, notifications, createNotification } = createHarness();

    const result = service.show(validRequest);
    expect(createNotification).toHaveBeenCalledWith({
      title: validRequest.title,
      body: validRequest.body,
      id: validRequest.tag,
      silent: true,
    });
    expect(notifications[0]?.show).toHaveBeenCalledOnce();

    notifications[0]?.emit("show", {});
    await expect(result).resolves.toEqual({ status: "shown" });
  });

  it("rejects invalid input without constructing a notification", async () => {
    const { service, createNotification, onWarning } = createHarness();

    await expect(service.show({ ...validRequest, title: "" })).resolves.toEqual({
      status: "failed",
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(onWarning).toHaveBeenCalledWith(
      "Rejected an invalid Desktop notification request",
      undefined
    );
  });

  it("reports and logs native failure events", async () => {
    const { service, notifications, onWarning } = createHarness();

    const result = service.show(validRequest);
    notifications[0]?.emit("failed", {}, "Windows rejected the toast");

    await expect(result).resolves.toEqual({ status: "failed" });
    expect(onWarning).toHaveBeenCalledWith(
      "Desktop notification failed on win32",
      "Windows rejected the toast"
    );
  });

  it("logs synchronous creation and show failures", async () => {
    const createError = new Error("constructor failed");
    const createNotification = vi.fn(() => {
      throw createError;
    });
    const onWarning = vi.fn();
    const service = createDesktopNotificationService({
      isSupported: () => true,
      createNotification,
      onClick: vi.fn(),
      onWarning,
      platform: "linux",
    });

    await expect(service.show(validRequest)).resolves.toEqual({ status: "failed" });
    expect(onWarning).toHaveBeenCalledWith(
      "Unable to create Desktop notification on linux",
      createError
    );

    const harness = createHarness();
    harness.createNotification.mockImplementationOnce(() => {
      const notification = new FakeNotification();
      notification.show.mockImplementation(() => {
        throw new Error("show failed");
      });
      harness.notifications.push(notification);
      return notification;
    });

    await expect(harness.service.show(validRequest)).resolves.toEqual({ status: "failed" });
    expect(harness.onWarning).toHaveBeenCalledWith(
      "Unable to show Desktop notification on win32",
      expect.objectContaining({ message: "show failed" })
    );
  });

  it("propagates the validated click target", async () => {
    const { service, notifications, onClick } = createHarness();

    const result = service.show(validRequest);
    notifications[0]?.emit("show", {});
    await result;
    notifications[0]?.emit("click", {});

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith({ workspaceId: "ws-1", sessionId: "sess-1" });
  });

  it("closes the retained notification when the same tag is replaced", async () => {
    const { service, notifications } = createHarness();

    const first = service.show(validRequest);
    notifications[0]?.emit("show", {});
    await first;

    const second = service.show(validRequest);
    expect(notifications[0]?.close).toHaveBeenCalledOnce();
    notifications[1]?.emit("show", {});
    await second;
  });

  it("settles optimistically when a platform omits delivery events", async () => {
    vi.useFakeTimers();
    const { service } = createHarness();

    const result = service.show(validRequest);
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual({ status: "shown" });
  });
});
