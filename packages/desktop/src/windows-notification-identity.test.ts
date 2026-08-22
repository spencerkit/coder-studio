import { describe, expect, it, vi } from "vitest";
import {
  configureWindowsNotificationIdentity,
  WINDOWS_APP_USER_MODEL_ID,
  WINDOWS_TOAST_ACTIVATOR_CLSID,
} from "./windows-notification-identity.js";

function createApp() {
  return {
    setAppUserModelId: vi.fn(),
    setToastActivatorCLSID: vi.fn(),
  };
}

describe("Windows notification identity", () => {
  it("sets one stable AUMID and Toast Activator CLSID on Windows", () => {
    const app = createApp();

    configureWindowsNotificationIdentity(app, "win32");

    expect(WINDOWS_APP_USER_MODEL_ID).toBe("com.coderstudio.desktop");
    expect(WINDOWS_TOAST_ACTIVATOR_CLSID).toMatch(
      /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/
    );
    expect(app.setAppUserModelId).toHaveBeenCalledOnce();
    expect(app.setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID);
    expect(app.setToastActivatorCLSID).toHaveBeenCalledOnce();
    expect(app.setToastActivatorCLSID).toHaveBeenCalledWith(WINDOWS_TOAST_ACTIVATOR_CLSID);
  });

  it.each(["darwin", "linux"] as const)("skips Windows identity setup on %s", (platform) => {
    const app = createApp();

    configureWindowsNotificationIdentity(app, platform);

    expect(app.setAppUserModelId).not.toHaveBeenCalled();
    expect(app.setToastActivatorCLSID).not.toHaveBeenCalled();
  });
});
