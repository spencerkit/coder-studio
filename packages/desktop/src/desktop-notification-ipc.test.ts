import { describe, expect, it, vi } from "vitest";
import { registerDesktopNotificationIpc } from "./desktop-notification-ipc.js";

describe("Desktop notification IPC", () => {
  it("registers the capability and delivery handlers", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    const service = {
      isSupported: vi.fn(() => true),
      show: vi.fn(async () => ({ status: "shown" as const })),
    };
    registerDesktopNotificationIpc({ ipc: ipc as never, service });

    expect([...handlers.keys()]).toEqual([
      "desktop:get-notification-support",
      "desktop:show-notification",
    ]);
    expect(handlers.get("desktop:get-notification-support")?.({})).toBe(true);

    const rawRequest = { title: "raw renderer value" };
    await expect(handlers.get("desktop:show-notification")?.({}, rawRequest)).resolves.toEqual({
      status: "shown",
    });
    expect(service.show).toHaveBeenCalledWith(rawRequest);
  });
});
