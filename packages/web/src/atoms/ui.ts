/**
 * UI Local State Management
 *
 * Persisted to localStorage. Written by: UI setters only.
 */

import { atom } from 'jotai';
import { atomWithStorage, atomFamily } from 'jotai/utils';

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
 * Auth state
 * Persisted: ui.authenticated
 */
export const authenticatedAtom = atomWithStorage<boolean>('ui.authenticated', false);

/**
 * Command palette open state
 */
export const commandPaletteOpenAtom = atom<boolean>(false);

/**
 * Sidebar collapsed state
 */
export const sidebarCollapsedAtom = atomWithStorage('ui.sidebarCollapsed', false);