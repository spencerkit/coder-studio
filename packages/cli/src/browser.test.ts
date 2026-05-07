import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { openBrowser } from "./browser.js";

const originalPlatform = process.platform;

describe("openBrowser windows child-process options", () => {
  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it("uses the Windows open command and passes windowsHide to spawn", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("spawn");
      });

      return child;
    });

    await expect(openBrowser("https://example.com")).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://example.com"],
      expect.objectContaining({ windowsHide: true })
    );
  });
});
