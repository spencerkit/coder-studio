import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyPaneLayout,
  readLegacyPaneLayout,
  readPaneRatio,
  writePaneRatio,
} from "./pane-layout";

describe("pane layout storage helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("returns null when localStorage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readLegacyPaneLayout("ws-1")).toBeNull();
    expect(readPaneRatio("ws-1", "root")).toBeNull();
  });

  it("swallows localStorage write and clear failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => writePaneRatio("ws-1", "root", 0.5)).not.toThrow();
    expect(() => clearLegacyPaneLayout("ws-1")).not.toThrow();
  });
});
