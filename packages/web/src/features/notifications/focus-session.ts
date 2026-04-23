/**
 * focusSession — single entry point for "bring this session into view"
 *
 * Two callers today:
 *   1. Toast click handler            (inside React tree, has react-router)
 *   2. System Notification onclick    (outside React tree, no hooks — but
 *                                      the closure that registered the
 *                                      onclick was inside React, so it can
 *                                      still hand us setters/navigators
 *                                      via the options bag)
 *
 * Both paths must:
 *   - switch the active workspace (so the right route renders),
 *   - update the URL (browser back-button friendly),
 *   - leave a "pending focus" marker so the target SessionCard can react
 *     once it mounts (the card may not exist yet — e.g. coming from a
 *     backgrounded tab in a different workspace).
 *
 * We deliberately DO NOT mutate the user's pane layout. If the target
 * session is not currently displayed (the user closed its pane), we leave
 * the layout alone — surprise layout edits from a notification click are
 * disorienting. The card will simply not light up; the user is at least
 * already in the right workspace.
 */

const ACTIVE_WORKSPACE_LS_KEY = 'ui.activeWorkspaceId';

export interface FocusSessionOptions {
  workspaceId: string;
  sessionId: string;
  /**
   * Persist the pending focus marker so any SessionCard with this id can
   * scroll/highlight itself. Pass `useSetAtom(pendingFocusSessionAtom)`
   * from a React caller, or close over the jotai store's setter from a
   * non-React onclick handler.
   */
  setPendingFocus: (sessionId: string | null) => void;
  /**
   * Optional react-router navigate function. When omitted (system
   * notifications), we fall back to `history.pushState` + a synthetic
   * `popstate`, which the router treats as a normal navigation.
   */
  navigate?: (path: string) => void;
}

export function focusSession(opts: FocusSessionOptions): void {
  const { workspaceId, sessionId, setPendingFocus, navigate } = opts;

  if (typeof window === 'undefined') return;

  // 1. Persist the active workspace so the workspace-switching atoms pick it
  //    up on the next render. atomWithStorage reads from localStorage, so
  //    we mirror its serialisation (JSON.stringify of the value).
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_LS_KEY, JSON.stringify(workspaceId));
  } catch {
    /* storage disabled — atom default will just keep whatever it had */
  }

  // 2. Hand the pending sessionId to the atom. We do this BEFORE navigation
  //    so that if the target SessionCard is already mounted, it sees the
  //    new value on the next render and reacts immediately.
  setPendingFocus(sessionId);

  // 3. Navigate to the workspace route.
  const path = `/workspace/${workspaceId}`;
  const alreadyThere = window.location.pathname === path;
  if (alreadyThere) return;
  if (navigate) {
    navigate(path);
  } else {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
