export const WINDOWS_APP_USER_MODEL_ID = "com.coderstudio.desktop";
export const WINDOWS_TOAST_ACTIVATOR_CLSID = "{F1A938B5-8E2C-4E7D-AB94-71D6C03F5A62}";

interface WindowsNotificationIdentityApp {
  setAppUserModelId(id: string): void;
  setToastActivatorCLSID(id: string): void;
}

export function configureWindowsNotificationIdentity(
  app: WindowsNotificationIdentityApp,
  platform: NodeJS.Platform
): void {
  if (platform !== "win32") return;
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  app.setToastActivatorCLSID(WINDOWS_TOAST_ACTIVATOR_CLSID);
}
