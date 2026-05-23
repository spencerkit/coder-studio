/**
 * Workspace Layout State
 *
 * Persisted UI state owned by the workspace feature.
 */

import { atomWithStorage, createJSONStorage } from "jotai/utils";

export type DesktopSidebarView = "explorer" | "search" | "source-control";
const DEFAULT_DESKTOP_SIDEBAR_VIEW: DesktopSidebarView = "explorer";
const DESKTOP_SIDEBAR_VIEW_VALUES = new Set<DesktopSidebarView>([
  "explorer",
  "search",
  "source-control",
]);

export function sanitizeDesktopSidebarView(value: unknown): DesktopSidebarView {
  return typeof value === "string" && DESKTOP_SIDEBAR_VIEW_VALUES.has(value as DesktopSidebarView)
    ? (value as DesktopSidebarView)
    : DEFAULT_DESKTOP_SIDEBAR_VIEW;
}

const baseDesktopSidebarStorage = createJSONStorage<DesktopSidebarView>(() => window.localStorage);
const desktopSidebarStorage = {
  ...baseDesktopSidebarStorage,
  getItem: (_key: string, initialValue: DesktopSidebarView) =>
    sanitizeDesktopSidebarView(
      baseDesktopSidebarStorage.getItem("ui.desktopSidebarView", initialValue)
    ),
  setItem: (key: string, value: DesktopSidebarView) =>
    baseDesktopSidebarStorage.setItem(key, sanitizeDesktopSidebarView(value)),
};

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
 * Desktop sidebar active view
 * Persisted: ui.desktopSidebarView
 */
export const desktopSidebarViewAtom = atomWithStorage<DesktopSidebarView>(
  "ui.desktopSidebarView",
  DEFAULT_DESKTOP_SIDEBAR_VIEW,
  desktopSidebarStorage,
  {
    getOnInit: true,
  }
);

/**
 * Terminal panel visible state
 * Persisted: ui.terminalPanelVisible
 */
export const terminalPanelVisibleAtom = atomWithStorage("ui.terminalPanelVisible", true);
