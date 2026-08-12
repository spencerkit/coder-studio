import type { BrowserWindow } from "electron";
import type { DesktopWindowActivityState } from "./protocol.js";

type WindowActivityReader = Pick<
  BrowserWindow,
  "isDestroyed" | "isFocused" | "isVisible" | "isMinimized"
>;

const INACTIVE_WINDOW_STATE: DesktopWindowActivityState = {
  focused: false,
  visible: false,
  minimized: false,
};

export function readDesktopWindowActivityState(
  window: WindowActivityReader | null
): DesktopWindowActivityState {
  if (!window || window.isDestroyed()) {
    return INACTIVE_WINDOW_STATE;
  }

  return {
    focused: window.isFocused(),
    visible: window.isVisible(),
    minimized: window.isMinimized(),
  };
}
