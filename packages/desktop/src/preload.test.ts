import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  return {
    exposeInMainWorld: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, listener);
    }),
    removeListener: vi.fn(),
    ipcListeners,
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

describe("Desktop preload", () => {
  it("buffers a notification click received before the Web listener subscribes", async () => {
    await import("./preload.js");

    const target = { workspaceId: "ws-1", sessionId: "sess-1" };
    const ipcListener = electronMocks.ipcListeners.get("desktop:notification-clicked");
    expect(ipcListener).toBeTypeOf("function");

    ipcListener?.({}, target);

    const api = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      onNotificationClicked(listener: (value: typeof target) => void): () => void;
    };
    const listener = vi.fn();
    const unsubscribe = api.onNotificationClicked(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(target);

    unsubscribe();
    ipcListener?.({}, { workspaceId: "ws-2", sessionId: "sess-2" });
    expect(listener).toHaveBeenCalledOnce();
  });
});
