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
  backendConfirmed: boolean;
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
        backendConfirmed: true,
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
        backendConfirmed: true,
        clearLegacyStorage: true,
      };
    } catch {
      return {
        settings: confirmedSettings,
        backendConfirmed: true,
        clearLegacyStorage: false,
      };
    }
  } catch {
    return {
      settings: cloneAppSettings(fallbackSettings),
      backendConfirmed: false,
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
