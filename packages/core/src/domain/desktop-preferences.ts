export const DESKTOP_PREFERENCES_SCHEMA_VERSION = 1 as const;

export interface DesktopPreferencesSnapshot {
  schemaVersion: typeof DESKTOP_PREFERENCES_SCHEMA_VERSION;
  revision: number;
  updatedAt: string | null;
  appearance: {
    themeId: string | null;
  };
}

export interface DesktopPreferencesPatch {
  appearance?: {
    themeId?: string;
  };
}

export function createDefaultDesktopPreferences(): DesktopPreferencesSnapshot {
  return {
    schemaVersion: DESKTOP_PREFERENCES_SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    appearance: {
      themeId: null,
    },
  };
}
