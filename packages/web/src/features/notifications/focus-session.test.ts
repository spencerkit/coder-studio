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

  it('persists the workspace id, sets the pending-focus marker, and navigates via the supplied router', () => {
    const setPendingFocus = vi.fn();
    const navigate = vi.fn();

    focusSession({
      workspaceId: 'ws-7',
      sessionId: 'sess-42',
      setPendingFocus,
      navigate,
    });

    expect(window.localStorage.getItem('ui.activeWorkspaceId')).toBe(JSON.stringify('ws-7'));
    expect(setPendingFocus).toHaveBeenCalledWith('sess-42');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-7');
  });

  it('falls back to history.pushState + popstate when no router is supplied (system-notification path)', () => {
    const setPendingFocus = vi.fn();
    const popstateSpy = vi.fn();
    window.addEventListener('popstate', popstateSpy);

    focusSession({
      workspaceId: 'ws-3',
      sessionId: 'sess-9',
      setPendingFocus,
    });

    expect(window.location.pathname).toBe('/workspace/ws-3');
    expect(popstateSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', popstateSpy);
  });

  it('does not navigate (or pushState) when already on the target route, but still updates focus marker', () => {
    window.history.pushState({}, '', '/workspace/ws-1');
    const setPendingFocus = vi.fn();
    const navigate = vi.fn();
    const popstateSpy = vi.fn();
    window.addEventListener('popstate', popstateSpy);

    focusSession({
      workspaceId: 'ws-1',
      sessionId: 'sess-11',
      setPendingFocus,
      navigate,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(popstateSpy).not.toHaveBeenCalled();
    expect(setPendingFocus).toHaveBeenCalledWith('sess-11');
    window.removeEventListener('popstate', popstateSpy);
  });

  it('survives a localStorage write failure without throwing', () => {
    const setPendingFocus = vi.fn();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() =>
      focusSession({
        workspaceId: 'ws-x',
        sessionId: 'sess-x',
        setPendingFocus,
      })
    ).not.toThrow();

    expect(setPendingFocus).toHaveBeenCalledWith('sess-x');
    setItemSpy.mockRestore();
  });
});
