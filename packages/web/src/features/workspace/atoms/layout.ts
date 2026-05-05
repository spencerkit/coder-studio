/**
 * Workspace Layout State
 *
 * Persisted UI state owned by the workspace feature.
 */

import { atomWithStorage } from "jotai/utils";

/**
 * Focus mode toggle (hides left/bottom panels)
 * Persisted: ui.focusMode
 */
export const focusModeAtom = atomWithStorage("ui.focusMode", false);

/**
 * Left panel width (file tree, git panel)
 * Persisted: ui.leftPanelWidth
 */
export const leftPanelWidthAtom = atomWithStorage("ui.leftPanelWidth", 280);

/**
 * Bottom panel height (terminal panel)
 * Persisted: ui.bottomPanelHeight
 */
export const bottomPanelHeightAtom = atomWithStorage("ui.bottomPanelHeight", 200);

/**
 * Sidebar collapsed state
 */
export const sidebarCollapsedAtom = atomWithStorage("ui.sidebarCollapsed", false);

/**
 * Terminal panel visible state
 * Persisted: ui.terminalPanelVisible
 */
export const terminalPanelVisibleAtom = atomWithStorage("ui.terminalPanelVisible", true);
