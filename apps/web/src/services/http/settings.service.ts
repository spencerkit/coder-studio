import type { Locale } from "../../i18n.ts";
import type { AppSettings, AppSettingsUpdater } from "../../types/app.ts";
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

export const createAppSettingsDraftStore = (initialSettings: AppSettings) => {
  let draftSettings = cloneAppSettings(initialSettings);

  return {
    get: (): AppSettings => cloneAppSettings(draftSettings),
    replace: (nextSettings: AppSettings): AppSettings => {
      draftSettings = cloneAppSettings(nextSettings);
      return cloneAppSettings(draftSettings);
    },
    update: (updater: (draft: AppSettings) => void): AppSettings => {
      const nextSettings = cloneAppSettings(draftSettings);
      updater(nextSettings);
      draftSettings = cloneAppSettings(nextSettings);
      return cloneAppSettings(draftSettings);
    },
  };
};

export const applyAppSettingsUpdater = (
  store: ReturnType<typeof createAppSettingsDraftStore>,
  updater: AppSettingsUpdater,
): AppSettings => store.replace(cloneAppSettings(updater(store.get())));

type HydrateConfirmedAppSettingsArgs = {
  fallbackSettings: AppSettings;
  legacySettings: AppSettings | null;
  preferredLocale: AppSettings["general"]["locale"];
  preferredLocaleIsExplicit?: boolean;
  load?: () => Promise<AppSettings>;
  persist?: (settings: AppSettings) => Promise<AppSettings>;
};

export const createPersistableAppSettings = (
  draftSettings: AppSettings,
  confirmedSettings: AppSettings,
  localeExplicit: boolean,
): AppSettings => {
  const nextSettings = cloneAppSettings(draftSettings);
  if (!localeExplicit) {
    nextSettings.general.locale = confirmedSettings.general.locale;
  }
  return nextSettings;
};

export const deriveRuntimeAppSettings = ({
  settings,
  localeExplicit,
  systemLocale,
  explicitLocale,
}: {
  settings: AppSettings;
  localeExplicit: boolean;
  systemLocale: Locale;
  explicitLocale?: Locale | null;
}): AppSettings => {
  const nextSettings = cloneAppSettings(settings);
  nextSettings.general.locale = localeExplicit
    ? (explicitLocale ?? settings.general.locale)
    : systemLocale;
  return nextSettings;
};

export const hydrateConfirmedAppSettings = async ({
  fallbackSettings,
  legacySettings,
  preferredLocale,
  preferredLocaleIsExplicit = false,
  load = getAppSettings,
  persist = updateAppSettings,
}: HydrateConfirmedAppSettingsArgs): Promise<{
  settings: AppSettings;
  backendConfirmed: boolean;
  clearLegacyStorage: boolean;
  localeExplicit: boolean;
}> => {
  try {
    const confirmedSettings = cloneAppSettings(await load());
    const shouldMigrateLegacy = legacySettings !== null
      && appSettingsPayloadEquals(confirmedSettings, fallbackSettings);
    const shouldSyncLocale = preferredLocaleIsExplicit
      && appSettingsPayloadEquals(confirmedSettings, fallbackSettings)
      && preferredLocale !== confirmedSettings.general.locale;
    const localeExplicit = preferredLocaleIsExplicit
      || confirmedSettings.general.locale !== fallbackSettings.general.locale;

    if (!shouldMigrateLegacy && !shouldSyncLocale) {
      return {
        settings: confirmedSettings,
        backendConfirmed: true,
        clearLegacyStorage: true,
        localeExplicit,
      };
    }

    const draft = shouldMigrateLegacy
      ? mergeLegacySettingsIntoAppSettings(confirmedSettings, legacySettings)
      : cloneAppSettings(confirmedSettings);
    if (shouldMigrateLegacy && legacySettings?.general.locale) {
      draft.general.locale = legacySettings.general.locale;
    } else if (shouldSyncLocale) {
      draft.general.locale = preferredLocale;
    }

    try {
      const persistedSettings = cloneAppSettings(await persist(draft));
      return {
        settings: persistedSettings,
        backendConfirmed: true,
        clearLegacyStorage: true,
        localeExplicit: preferredLocaleIsExplicit
          || persistedSettings.general.locale !== fallbackSettings.general.locale,
      };
    } catch {
      return {
        settings: confirmedSettings,
        backendConfirmed: true,
        clearLegacyStorage: false,
        localeExplicit,
      };
    }
  } catch {
    return {
      settings: cloneAppSettings(fallbackSettings),
      backendConfirmed: false,
      clearLegacyStorage: false,
      localeExplicit: preferredLocaleIsExplicit,
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

type SequencedSaveState = {
  settings: AppSettings;
  success: boolean;
  backendConfirmed: boolean;
};

const findLatestVisibleSave = (
  latestRequestId: number,
  pendingRequestIds: ReadonlySet<number>,
  settledRequests: ReadonlyMap<number, SequencedSaveState>,
): { requestId: number; settings: AppSettings; backendConfirmed: boolean } | null => {
  for (let requestId = latestRequestId; requestId >= 1; requestId -= 1) {
    if (pendingRequestIds.has(requestId)) {
      return null;
    }

    const settled = settledRequests.get(requestId);
    if (!settled) {
      continue;
    }
    if (settled.success) {
      return {
        requestId,
        settings: cloneAppSettings(settled.settings),
        backendConfirmed: settled.backendConfirmed,
      };
    }
  }

  return null;
};

export const createSequencedAppSettingsSaver = () => {
  let latestRequestId = 0;
  let lastAppliedRequestId = 0;
  const pendingRequestIds = new Set<number>();
  const settledRequests = new Map<number, SequencedSaveState>();

  const pruneSettledRequests = () => {
    for (const requestId of settledRequests.keys()) {
      if (requestId < lastAppliedRequestId && !pendingRequestIds.has(requestId)) {
        settledRequests.delete(requestId);
      }
    }
  };

  return {
    save: async (
      confirmedSettings: AppSettings,
      draftSettings: AppSettings,
      persist: (settings: AppSettings) => Promise<AppSettings> = updateAppSettings,
      confirmedSettingsAreBackendConfirmed = true,
    ): Promise<{
      settings: AppSettings;
      backendConfirmed: boolean;
      shouldApply: boolean;
    }> => {
      latestRequestId += 1;
      const requestId = latestRequestId;
      pendingRequestIds.add(requestId);

      try {
        settledRequests.set(requestId, {
          settings: cloneAppSettings(await persist(cloneAppSettings(draftSettings))),
          success: true,
          backendConfirmed: true,
        });
      } catch {
        settledRequests.set(requestId, {
          settings: cloneAppSettings(confirmedSettings),
          success: false,
          backendConfirmed: confirmedSettingsAreBackendConfirmed,
        });
      } finally {
        pendingRequestIds.delete(requestId);
      }

      const visibleSave = findLatestVisibleSave(latestRequestId, pendingRequestIds, settledRequests);
      if (!visibleSave || visibleSave.requestId === lastAppliedRequestId) {
        pruneSettledRequests();
        return {
          settings: visibleSave
            ? cloneAppSettings(visibleSave.settings)
            : cloneAppSettings(confirmedSettings),
          backendConfirmed: visibleSave?.backendConfirmed ?? confirmedSettingsAreBackendConfirmed,
          shouldApply: false,
        };
      }

      lastAppliedRequestId = visibleSave.requestId;
      pruneSettledRequests();
      return {
        settings: cloneAppSettings(visibleSave.settings),
        backendConfirmed: visibleSave.backendConfirmed,
        shouldApply: true,
      };
    },
  };
};
