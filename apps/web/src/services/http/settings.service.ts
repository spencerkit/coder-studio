import type { AppSettings } from "../../types/app.ts";
import {
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
