import type { AppSettings } from "../../types/app.ts";
import {
  cloneAppSettings,
  normalizeAppSettings,
  toAppSettingsPayload,
} from "../../shared/app/claude-settings.ts";
import { invokeRpc } from "./client.ts";

export const getAppSettings = async (): Promise<AppSettings> => (
  normalizeAppSettings(await invokeRpc<unknown>("app_settings_get", {}))
);

export const updateAppSettings = async (settings: AppSettings): Promise<AppSettings> => (
  normalizeAppSettings(
    await invokeRpc<unknown>("app_settings_update", {
      settings: toAppSettingsPayload(settings),
    }),
  )
);

export const persistConfirmedAppSettings = async (
  confirmedSettings: AppSettings,
  draftSettings: AppSettings,
  persist: (settings: AppSettings) => Promise<AppSettings> = updateAppSettings,
): Promise<AppSettings> => {
  try {
    return cloneAppSettings(await persist(cloneAppSettings(draftSettings)));
  } catch {
    return cloneAppSettings(confirmedSettings);
  }
};
