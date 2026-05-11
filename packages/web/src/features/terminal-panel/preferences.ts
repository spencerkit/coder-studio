import { atomWithStorage } from "jotai/utils";

export interface TerminalPreferences {
  copyOnSelect: boolean;
}

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  copyOnSelect: false,
};

export function resolveTerminalCopyOnSelectSetting(settings: Record<string, unknown>): boolean {
  const value = settings["appearance.terminalCopyOnSelect"];
  return typeof value === "boolean" ? value : DEFAULT_TERMINAL_PREFERENCES.copyOnSelect;
}

export const terminalPreferencesAtom = atomWithStorage<TerminalPreferences>(
  "ui.terminalPreferences",
  DEFAULT_TERMINAL_PREFERENCES
);
