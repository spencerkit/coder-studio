import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusSession } from './focus-session';

describe('focusSession', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('sets the active workspace in memory, sets the pending-focus marker, and navigates via the supplied router', () => {
    const setPendingFocus = vi.fn();
    const setActiveWorkspaceId = vi.fn();
    const navigate = vi.fn();

    focusSession({
      workspaceId: 'ws-7',
      sessionId: 'sess-42',
      setPendingFocus,
      setActiveWorkspaceId,
      navigate,
    });

    expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws-7');
    expect(setPendingFocus).toHaveBeenCalledWith('sess-42');
    expect(navigate).toHaveBeenCalledWith('/workspace');
    expect(window.localStorage.length).toBe(0);
  });

  it('falls back to history.pushState + popstate when no router is supplied (system-notification path)', () => {
    const setPendingFocus = vi.fn();
    const setActiveWorkspaceId = vi.fn();
    const popstateSpy = vi.fn();
    window.addEventListener('popstate', popstateSpy);

    focusSession({
      workspaceId: 'ws-3',
      sessionId: 'sess-9',
      setPendingFocus,
      setActiveWorkspaceId,
    });

    expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws-3');
    expect(window.location.pathname).toBe('/workspace');
    expect(popstateSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', popstateSpy);
  });

  it('does not navigate (or pushState) when already on the target route, but still updates focus marker', () => {
    window.history.pushState({}, '', '/workspace');
    const setPendingFocus = vi.fn();
    const setActiveWorkspaceId = vi.fn();
    const navigate = vi.fn();
    const popstateSpy = vi.fn();
    window.addEventListener('popstate', popstateSpy);

    focusSession({
      workspaceId: 'ws-1',
      sessionId: 'sess-11',
      setPendingFocus,
      setActiveWorkspaceId,
      navigate,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(popstateSpy).not.toHaveBeenCalled();
    expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws-1');
    expect(setPendingFocus).toHaveBeenCalledWith('sess-11');
    window.removeEventListener('popstate', popstateSpy);
  });
});
