import { describe, expect, it, vi } from "vitest";
import { registerDesktopPreferencesIpc } from "./desktop-preferences-ipc.js";

describe("Desktop preferences IPC", () => {
  it("registers read, migration, and update handlers with validated values", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    const snapshot = {
      schemaVersion: 1 as const,
      revision: 2,
      updatedAt: "2026-08-26T12:30:00.000Z",
      appearance: { themeId: "nord-dark" },
    };
    const store = {
      getSnapshot: vi.fn(() => snapshot),
      initializeTheme: vi.fn(async () => snapshot),
      update: vi.fn(async () => snapshot),
    };
    registerDesktopPreferencesIpc({ ipc: ipc as never, getStore: () => store });

    expect([...handlers.keys()]).toEqual([
      "desktop:get-preferences",
      "desktop:initialize-theme-preference",
      "desktop:update-preferences",
    ]);
    expect(handlers.get("desktop:get-preferences")?.({})).toEqual(snapshot);
    await expect(
      handlers.get("desktop:initialize-theme-preference")?.({}, "mint-dark")
    ).resolves.toEqual(snapshot);
    await expect(
      handlers.get("desktop:update-preferences")?.(
        {},
        {
          appearance: { themeId: "mint-light" },
        }
      )
    ).resolves.toEqual(snapshot);
    expect(store.initializeTheme).toHaveBeenCalledWith("mint-dark");
    expect(store.update).toHaveBeenCalledWith({ appearance: { themeId: "mint-light" } });
  });

  it("rejects malformed renderer input before it reaches the store", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    };
    const store = {
      getSnapshot: vi.fn(),
      initializeTheme: vi.fn(),
      update: vi.fn(),
    };
    registerDesktopPreferencesIpc({ ipc, getStore: () => store as never });

    expect(() => handlers.get("desktop:initialize-theme-preference")?.({}, "bad\nvalue")).toThrow(
      "Invalid Desktop theme id"
    );
    expect(() => handlers.get("desktop:update-preferences")?.({}, {})).toThrow(
      "no supported values"
    );
    expect(store.initializeTheme).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });
});
