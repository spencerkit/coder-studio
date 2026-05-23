/**
 * Application UI State
 *
 * Shared app-level UI state that is not owned by a single feature.
 */

import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { resolveStoredThemeId } from "../theme";

const THEME_ID_STORAGE_KEY = "ui.themeId";
const LEGACY_THEME_STORAGE_KEY = "ui.theme";

const baseThemeStorage = createJSONStorage<string>(() => window.localStorage);

function readThemePreferenceFromStorage(initialValue: string): string {
  if (typeof window === "undefined") {
    return initialValue;
  }

  const storedThemeId = window.localStorage.getItem(THEME_ID_STORAGE_KEY);
  if (storedThemeId !== null) {
    try {
      return resolveStoredThemeId(JSON.parse(storedThemeId));
    } catch {
      return initialValue;
    }
  }

  const legacyTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  if (legacyTheme !== null) {
    try {
      return resolveStoredThemeId(JSON.parse(legacyTheme));
    } catch {
      return initialValue;
    }
  }

  return initialValue;
}

const themeStorage = {
  ...baseThemeStorage,
  getItem: (_key: string, initialValue: string) => readThemePreferenceFromStorage(initialValue),
  setItem: (key: string, value: string) =>
    baseThemeStorage.setItem(key, resolveStoredThemeId(value) as string),
};

/**
 * Theme preference
 * Persisted: ui.themeId
 */
export const themeAtom = atomWithStorage<string>(THEME_ID_STORAGE_KEY, "mint-dark", themeStorage, {
  getOnInit: true,
});

/**
 * Locale preference
 * Persisted: ui.locale
 */
export const localeAtom = atomWithStorage<string>("ui.locale", "zh");

/**
 * Auth state
 * Derived from server session status, not persisted locally.
 */
export const authenticatedAtom = atom<boolean>(false);

/**
 * Command palette open state
 */
export const commandPaletteOpenAtom = atom<boolean>(false);

/**
 * Quick Open overlay state
 */
export const quickOpenOpenAtom = atom<boolean>(false);

/**
 * Pending session-focus request.
 *
 * Set when something outside the workspace UI wants to bring a specific
 * session into view.
 */
export const pendingFocusSessionAtom = atom<string | null>(null);

/**
 * Server-hydrated global last-viewed workspace/session target.
 *
 * This mirrors the server-backed cross-device target and is not persisted
 * locally. Desktop restores only `workspaceId`; mobile can additionally use
 * `sessionId` during session selection.
 */
export const lastViewedTargetAtom = atom<WorkspaceLastViewedTarget | null>(null);

/**
 * Currently visible session in the mobile workspace shell.
 *
 * This is transient render state, not persisted workspace UI state.
 */
export const visibleMobileSessionIdAtom = atom<string | null>(null);
