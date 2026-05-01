/**
 * Application UI State
 *
 * Shared app-level UI state that is not owned by a single feature.
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * Theme preference
 * Persisted: ui.theme
 */
export const themeAtom = atomWithStorage<'dark' | 'light'>('ui.theme', 'dark');

/**
 * Locale preference
 * Persisted: ui.locale
 */
export const localeAtom = atomWithStorage<string>('ui.locale', 'zh');

/**
 * Auth state
 * Persisted: ui.authenticated
 */
export const authenticatedAtom = atomWithStorage<boolean>('ui.authenticated', false);

/**
 * Command palette open state
 */
export const commandPaletteOpenAtom = atom<boolean>(false);

/**
 * Pending session-focus request.
 *
 * Set when something outside the workspace UI wants to bring a specific
 * session into view.
 */
export const pendingFocusSessionAtom = atom<string | null>(null);
