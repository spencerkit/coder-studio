/**
 * UI Local State Management
 *
 * Persisted to localStorage. Written by: UI setters only.
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

/**
 * Focus mode toggle (hides left/bottom panels)
 * Persisted: ui.focusMode
 */
export const focusModeAtom = atomWithStorage('ui.focusMode', false);

/**
 * Left panel width (file tree, git panel)
 * Persisted: ui.leftPanelWidth
 */
export const leftPanelWidthAtom = atomWithStorage('ui.leftPanelWidth', 280);

/**
 * Bottom panel height (terminal panel)
 * Persisted: ui.bottomPanelHeight
 */
export const bottomPanelHeightAtom = atomWithStorage('ui.bottomPanelHeight', 200);

/**
 * Active workspace ID (persisted for workspaceByIdAtomFamily)
 * Persisted: ui.activeWorkspaceId
 */
export const activeWorkspaceIdAtom = atomWithStorage<string | null>(
  'ui.activeWorkspaceId',
  null
);

/**
 * Pane layout by workspace (agent pane splits)
 * Persisted: ui.paneLayout.<workspaceId>
 */
export interface PaneNode {
  id: string;
  type: 'leaf' | 'split';
  sessionId?: string; // Only for leaf nodes
  direction?: 'horizontal' | 'vertical'; // Only for split nodes
  ratio?: number; // Split ratio (0-1), only for split nodes
  children?: PaneNode[]; // Only for split nodes
}

const defaultPaneLayout: PaneNode = {
  id: 'root',
  type: 'leaf',
};

export const paneLayoutAtomFamily = atomFamily((workspaceId: string) =>
  atomWithStorage<PaneNode>(`ui.paneLayout.${workspaceId}`, defaultPaneLayout)
);

/**
 * Theme preference (Phase 4 will support light/dark)
 * Persisted: ui.theme
 */
export const themeAtom = atomWithStorage<'dark' | 'light'>('ui.theme', 'dark');

/**
 * Locale preference
 * Persisted: ui.locale
 */
export const localeAtom = atomWithStorage<string>('ui.locale', 'zh');

/**
 * Notification preferences
 * Persisted so the notification engine can respect the latest settings
 * even before the user re-opens Settings.
 *
 * Channel selection is automatic based on workspace focus + page visibility:
 *   - Active workspace + page visible → suppressed
 *   - Inactive workspace + page visible → in-app banner toast
 *   - Page hidden → system (browser) push notification
 *
 * `enabled`      master switch for any notification (sound, toast, system push)
 * `soundEnabled` whether to play the completion chime when a notification fires
 */
export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
}

export const notificationPreferencesAtom = atomWithStorage<NotificationPreferences>(
  'ui.notificationPreferences',
  {
    enabled: true,
    soundEnabled: true,
  }
);

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
 * Set when something outside the workspace UI (e.g. a toast click or a
 * system notification) wants to bring a specific session into view.
 * The corresponding `<SessionCard>` watches this atom and, when its own id
 * appears, scrolls itself into view, briefly highlights itself, and
 * clears the value back to `null`.
 *
 * In-memory only: the marker only needs to bridge a single same-tab route
 * change, and React Router transitions are synchronous within the same tab.
 * Persisting to (session|local)Storage would risk re-firing the highlight
 * on every page reload.
 */
export const pendingFocusSessionAtom = atom<string | null>(null);

/**
 * Sidebar collapsed state
 */
export const sidebarCollapsedAtom = atomWithStorage('ui.sidebarCollapsed', false);
