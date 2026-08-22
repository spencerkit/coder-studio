import { describe, expect, it, vi } from "vitest";
import { activateDesktopNotificationTarget } from "./desktop-notification-activation.js";

const target = { workspaceId: "ws-1", sessionId: "sess-1" };

function createWindow(
  overrides: Partial<{
    destroyed: boolean;
    minimized: boolean;
    webContentsDestroyed: boolean;
  }> = {}
) {
  const order: string[] = [];
  let didFinishLoad: (() => void) | null = null;
  const window = {
    isDestroyed: vi.fn(() => overrides.destroyed ?? false),
    isMinimized: vi.fn(() => overrides.minimized ?? false),
    restore: vi.fn(() => order.push("restore")),
    show: vi.fn(() => order.push("show")),
    focus: vi.fn(() => order.push("focus")),
    webContents: {
      isDestroyed: vi.fn(() => overrides.webContentsDestroyed ?? false),
      send: vi.fn(() => order.push("send")),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === "did-finish-load") didFinishLoad = listener;
      }),
    },
  };
  return {
    window,
    order,
    finishLoad: () => {
      const listener = didFinishLoad as (() => void) | null;
      listener?.();
    },
  };
}

describe("Desktop notification activation", () => {
  it("restores, shows, focuses, and forwards a click target", () => {
    const harness = createWindow({ minimized: true });

    const activated = activateDesktopNotificationTarget({
      target,
      window: harness.window as never,
      createWindow: vi.fn(),
      shuttingDown: false,
    });

    expect(activated).toBe(harness.window);
    expect(harness.order).toEqual(["restore", "show", "focus", "send"]);
    expect(harness.window.webContents.send).toHaveBeenCalledWith(
      "desktop:notification-clicked",
      target
    );
  });

  it("does not restore an ordinary live window", () => {
    const harness = createWindow();

    activateDesktopNotificationTarget({
      target,
      window: harness.window as never,
      createWindow: vi.fn(),
      shuttingDown: false,
    });

    expect(harness.window.restore).not.toHaveBeenCalled();
    expect(harness.order).toEqual(["show", "focus", "send"]);
  });

  it("activates but does not send through destroyed WebContents", () => {
    const harness = createWindow({ webContentsDestroyed: true });

    activateDesktopNotificationTarget({
      target,
      window: harness.window as never,
      createWindow: vi.fn(),
      shuttingDown: false,
    });

    expect(harness.order).toEqual(["show", "focus"]);
    expect(harness.window.webContents.send).not.toHaveBeenCalled();
  });

  it("recreates a missing window and forwards the target after load", () => {
    const harness = createWindow();
    const createMainWindow = vi.fn(() => harness.window as never);

    const activated = activateDesktopNotificationTarget({
      target,
      window: null,
      createWindow: createMainWindow,
      shuttingDown: false,
    });

    expect(activated).toBe(harness.window);
    expect(createMainWindow).toHaveBeenCalledOnce();
    expect(harness.order).toEqual(["show", "focus"]);
    expect(harness.window.webContents.once).toHaveBeenCalledWith(
      "did-finish-load",
      expect.any(Function)
    );

    harness.finishLoad();
    expect(harness.order).toEqual(["show", "focus", "send"]);
  });

  it("does nothing after shutdown starts", () => {
    const harness = createWindow({ minimized: true });
    const createMainWindow = vi.fn();

    const activated = activateDesktopNotificationTarget({
      target,
      window: harness.window as never,
      createWindow: createMainWindow,
      shuttingDown: true,
    });

    expect(activated).toBeNull();
    expect(harness.order).toEqual([]);
    expect(createMainWindow).not.toHaveBeenCalled();
  });
});
