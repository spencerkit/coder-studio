import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { openBrowser } from "./browser.js";

describe("openBrowser windows child-process options", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes windowsHide to spawn", async () => {
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
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true })
    );
  });
});
