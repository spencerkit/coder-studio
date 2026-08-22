import type { BrowserWindow } from "electron";
import type { DesktopNotificationTarget } from "./protocol.js";

type NotificationWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "isMinimized" | "restore" | "show" | "focus" | "webContents"
>;

interface ActivateDesktopNotificationTargetOptions {
  target: DesktopNotificationTarget;
  window: NotificationWindow | null;
  createWindow(): NotificationWindow | null;
  shuttingDown: boolean;
}

export function activateDesktopNotificationTarget({
  target,
  window: existingWindow,
  createWindow,
  shuttingDown,
}: ActivateDesktopNotificationTargetOptions): NotificationWindow | null {
  if (shuttingDown) return null;

  const needsWindow = !existingWindow || existingWindow.isDestroyed();
  const window = needsWindow ? createWindow() : existingWindow;
  if (!window || window.isDestroyed()) return null;

  const sendTarget = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send("desktop:notification-clicked", target);
  };

  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();

  if (needsWindow) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.once("did-finish-load", sendTarget);
    }
  } else {
    sendTarget();
  }

  return window;
}
