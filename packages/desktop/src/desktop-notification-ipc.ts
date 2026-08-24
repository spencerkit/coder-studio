import type { IpcMain } from "electron";
import type { DesktopNotificationService } from "./desktop-notifications.js";

interface RegisterDesktopNotificationIpcOptions {
  ipc: Pick<IpcMain, "handle">;
  service: DesktopNotificationService;
}

export function registerDesktopNotificationIpc({
  ipc,
  service,
}: RegisterDesktopNotificationIpcOptions): void {
  ipc.handle("desktop:get-notification-support", () => service.isSupported());
  ipc.handle("desktop:show-notification", (_event, value: unknown) => service.show(value));
}
