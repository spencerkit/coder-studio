import { atomWithStorage } from "jotai/utils";

export interface TerminalPreferences {
  copyOnSelect: boolean;
  fontSize: number;
}

export const DEFAULT_TERMINAL_FONT_SIZE = 11;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 18;

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  copyOnSelect: false,
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
};

export function resolveTerminalCopyOnSelectSetting(settings: Record<string, unknown>): boolean {
  const value = settings["appearance.terminalCopyOnSelect"];
  return typeof value === "boolean" ? value : DEFAULT_TERMINAL_PREFERENCES.copyOnSelect;
}

export function resolveTerminalFontSizeSetting(settings: Record<string, unknown>): number {
  const value = settings["appearance.terminalFontSize"];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= MIN_TERMINAL_FONT_SIZE &&
    value <= MAX_TERMINAL_FONT_SIZE
    ? value
    : DEFAULT_TERMINAL_PREFERENCES.fontSize;
}

export const terminalPreferencesAtom = atomWithStorage<TerminalPreferences>(
  "ui.terminalPreferences",
  DEFAULT_TERMINAL_PREFERENCES
);
