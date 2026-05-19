import { atomWithStorage, createJSONStorage } from "jotai/utils";

export interface TerminalPreferences {
  copyOnSelect: boolean;
  fontSize: number;
  desktopFontSize?: number;
  mobileFontSize?: number;
}

export const DEFAULT_TERMINAL_FONT_SIZE = 11;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 18;
export const LEGACY_TERMINAL_FONT_SIZE_SETTING_KEY = "appearance.terminalFontSize";
export const DESKTOP_TERMINAL_FONT_SIZE_SETTING_KEY = "appearance.desktopTerminalFontSize";
export const MOBILE_TERMINAL_FONT_SIZE_SETTING_KEY = "appearance.mobileTerminalFontSize";

export type TerminalFontSizeTarget = "desktop" | "mobile";

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  copyOnSelect: true,
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
};

export function resolveTerminalCopyOnSelectSetting(settings: Record<string, unknown>): boolean {
  const value = settings["appearance.terminalCopyOnSelect"];
  return typeof value === "boolean" ? value : DEFAULT_TERMINAL_PREFERENCES.copyOnSelect;
}

function resolveTerminalFontSizeValue(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= MIN_TERMINAL_FONT_SIZE &&
    value <= MAX_TERMINAL_FONT_SIZE
    ? value
    : null;
}

export function hasLegacyTerminalFontSizeSetting(settings: Record<string, unknown>): boolean {
  return Object.hasOwn(settings, LEGACY_TERMINAL_FONT_SIZE_SETTING_KEY);
}

export function hasExplicitTerminalFontSizeSetting(
  settings: Record<string, unknown>,
  target: TerminalFontSizeTarget
): boolean {
  return Object.hasOwn(
    settings,
    target === "mobile"
      ? MOBILE_TERMINAL_FONT_SIZE_SETTING_KEY
      : DESKTOP_TERMINAL_FONT_SIZE_SETTING_KEY
  );
}

export function resolveLegacyTerminalFontSizeSetting(settings: Record<string, unknown>): number {
  return (
    resolveTerminalFontSizeValue(settings[LEGACY_TERMINAL_FONT_SIZE_SETTING_KEY]) ??
    DEFAULT_TERMINAL_PREFERENCES.fontSize
  );
}

export function resolveTerminalFontSizeSetting(
  settings: Record<string, unknown>,
  target: TerminalFontSizeTarget
): number {
  const explicitValue = resolveTerminalFontSizeValue(
    settings[
      target === "mobile"
        ? MOBILE_TERMINAL_FONT_SIZE_SETTING_KEY
        : DESKTOP_TERMINAL_FONT_SIZE_SETTING_KEY
    ]
  );
  if (explicitValue !== null) {
    return explicitValue;
  }

  return resolveLegacyTerminalFontSizeSetting(settings);
}

export function getTerminalFontSizePreference(
  preferences: TerminalPreferences,
  target: TerminalFontSizeTarget
): number {
  const fallback =
    resolveTerminalFontSizeValue(preferences.fontSize) ?? DEFAULT_TERMINAL_PREFERENCES.fontSize;
  const explicitValue = resolveTerminalFontSizeValue(
    target === "mobile" ? preferences.mobileFontSize : preferences.desktopFontSize
  );

  return explicitValue ?? fallback;
}

export function getTerminalFontSizeForViewport(
  preferences: TerminalPreferences,
  viewport: "desktop" | "mobile"
): number {
  return getTerminalFontSizePreference(preferences, viewport === "mobile" ? "mobile" : "desktop");
}

function normalizeStoredTerminalPreferences(
  value: unknown,
  initialValue: TerminalPreferences
): TerminalPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return initialValue;
  }

  const stored = value as Partial<TerminalPreferences>;
  const fallbackFontSize = resolveTerminalFontSizeValue(stored.fontSize) ?? initialValue.fontSize;
  const desktopFontSize = resolveTerminalFontSizeValue(stored.desktopFontSize) ?? fallbackFontSize;
  const mobileFontSize = resolveTerminalFontSizeValue(stored.mobileFontSize) ?? fallbackFontSize;

  return {
    copyOnSelect:
      typeof stored.copyOnSelect === "boolean" ? stored.copyOnSelect : initialValue.copyOnSelect,
    fontSize: fallbackFontSize,
    desktopFontSize,
    mobileFontSize,
  };
}

const baseTerminalPreferencesStorage = createJSONStorage<TerminalPreferences>(
  () => window.localStorage
);

const terminalPreferencesStorage = {
  ...baseTerminalPreferencesStorage,
  getItem: (_key: string, initialValue: TerminalPreferences) =>
    normalizeStoredTerminalPreferences(
      baseTerminalPreferencesStorage.getItem("ui.terminalPreferences", initialValue),
      initialValue
    ),
  setItem: (key: string, value: TerminalPreferences) =>
    baseTerminalPreferencesStorage.setItem(key, normalizeStoredTerminalPreferences(value, value)),
};

export const terminalPreferencesAtom = atomWithStorage<TerminalPreferences>(
  "ui.terminalPreferences",
  DEFAULT_TERMINAL_PREFERENCES,
  terminalPreferencesStorage,
  {
    getOnInit: true,
  }
);
