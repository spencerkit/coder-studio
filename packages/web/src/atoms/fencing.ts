/**
 * Fencing atoms for multi-tab concurrency (Phase 3)
 */

import { atom } from "jotai";

export interface FencingState {
  /** Whether this tab is the controller */
  isController: boolean;
  /** Reason for not being controller */
  reason?: "another_tab_active" | "controller_responsive";
  /** Tab ID for this session */
  tabId: string;
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
}

// Generate a unique tab ID
const generateTabId = () => {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Current tab ID (persistent for this session)
export const tabIdAtom = atom<string>(generateTabId());

// Fencing state per workspace
export const fencingStateAtom = atom<Map<string, FencingState>>(new Map());

// Derived atom for checking if current tab is controller
export const isControllerAtom = atom((get) => (workspaceId: string) => {
  const states = get(fencingStateAtom);
  const state = states.get(workspaceId);
  return state?.isController ?? false;
});

// Derived atom for getting fencing reason
export const fencingReasonAtom = atom((get) => (workspaceId: string) => {
  const states = get(fencingStateAtom);
  const state = states.get(workspaceId);
  return state?.reason;
});

// Read-only mode indicator
export const readOnlyModeAtom = atom((get) => {
  const states = get(fencingStateAtom);
  // If any workspace is not controller, we're in read-only mode for that workspace
  for (const state of states.values()) {
    if (!state.isController) {
      return true;
    }
  }
  return false;
});
