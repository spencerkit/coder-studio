import type { AppSettings } from "../../types/app.ts";
import {
  appSettingsPayloadEquals,
  cloneAppSettings,
  mergeLegacySettingsIntoAppSettings,
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

type HydrateConfirmedAppSettingsArgs = {
  fallbackSettings: AppSettings;
  legacySettings: AppSettings | null;
  preferredLocale: AppSettings["general"]["locale"];
  load?: () => Promise<AppSettings>;
  persist?: (settings: AppSettings) => Promise<AppSettings>;
};

export const hydrateConfirmedAppSettings = async ({
  fallbackSettings,
  legacySettings,
  preferredLocale,
  load = getAppSettings,
  persist = updateAppSettings,
}: HydrateConfirmedAppSettingsArgs): Promise<{
  settings: AppSettings;
  clearLegacyStorage: boolean;
}> => {
  try {
    const confirmedSettings = cloneAppSettings(await load());
    const shouldMigrateLegacy = legacySettings !== null
      && appSettingsPayloadEquals(confirmedSettings, fallbackSettings);
    const shouldSyncLocale = appSettingsPayloadEquals(confirmedSettings, fallbackSettings)
      && preferredLocale !== confirmedSettings.general.locale;

    if (!shouldMigrateLegacy && !shouldSyncLocale) {
      return {
        settings: confirmedSettings,
        clearLegacyStorage: true,
      };
    }

    const draft = shouldMigrateLegacy
      ? mergeLegacySettingsIntoAppSettings(confirmedSettings, legacySettings)
      : cloneAppSettings(confirmedSettings);
    draft.general.locale = shouldMigrateLegacy && legacySettings?.general.locale
      ? legacySettings.general.locale
      : preferredLocale;

    try {
      return {
        settings: cloneAppSettings(await persist(draft)),
        clearLegacyStorage: true,
      };
    } catch {
      return {
        settings: confirmedSettings,
        clearLegacyStorage: false,
      };
    }
  } catch {
    return {
      settings: cloneAppSettings(fallbackSettings),
      clearLegacyStorage: false,
    };
  }
};

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
