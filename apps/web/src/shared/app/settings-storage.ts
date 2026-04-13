import type { AppSettings } from "../../types/app";
import {
  cloneAppSettings,
  defaultAppSettings,
  getSettingsLocale,
  normalizeAppSettings,
} from "./app-settings";

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";

export { cloneAppSettings, defaultAppSettings, getSettingsLocale };

export const readStoredAppSettings = (): AppSettings | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const clearStoredAppSettings = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
};
