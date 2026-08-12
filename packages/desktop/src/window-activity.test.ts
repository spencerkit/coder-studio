import { describe, expect, it, vi } from "vitest";
import { readDesktopWindowActivityState } from "./window-activity.js";

function createWindowState(
  overrides: Partial<{
    destroyed: boolean;
    focused: boolean;
    visible: boolean;
    minimized: boolean;
  }> = {}
) {
  const state = {
    destroyed: false,
    focused: true,
    visible: true,
    minimized: false,
    ...overrides,
  };

  return {
    isDestroyed: vi.fn(() => state.destroyed),
    isFocused: vi.fn(() => state.focused),
    isVisible: vi.fn(() => state.visible),
    isMinimized: vi.fn(() => state.minimized),
  };
}

describe("Desktop window activity", () => {
  it("reads the current BrowserWindow attention state", () => {
    const window = createWindowState({ focused: false, minimized: true });

    expect(readDesktopWindowActivityState(window)).toEqual({
      focused: false,
      visible: true,
      minimized: true,
    });
  });

  it("returns an inactive state when no usable window exists", () => {
    expect(readDesktopWindowActivityState(null)).toEqual({
      focused: false,
      visible: false,
      minimized: false,
    });
    expect(readDesktopWindowActivityState(createWindowState({ destroyed: true }))).toEqual({
      focused: false,
      visible: false,
      minimized: false,
    });
  });
});
