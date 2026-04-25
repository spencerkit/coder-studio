import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { ToastContainer } from './toast-container';
import { toastsAtom, type Toast } from './atoms';
import { activeWorkspaceIdAtom, pendingFocusSessionAtom } from '../../atoms/ui';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

describe('ToastContainer', () => {
  beforeEach(() => {
    navigate.mockReset();
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  /**
   * Seed the toast directly via `toastsAtom` (bypassing `pushToastAtom`)
   * so the container renders with the toast already present on first
   * paint — no need to wrap a post-render store mutation in act/waitFor.
   */
  function renderWithToast(toast: Omit<Toast, 'id' | 'createdAt'>) {
    const store = createStore();
    store.set(toastsAtom, [{ ...toast, id: 'toast-test', createdAt: Date.now() }]);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ToastContainer />
        </MemoryRouter>
      </Provider>
    );
    return store;
  }

  it('clicking a session-bearing toast navigates to the workspace and sets the pending-focus marker', () => {
    const store = renderWithToast({
      kind: 'success',
      title: 'Session done',
      body: 'Claude · demo · 1m',
      workspaceId: 'ws-9',
      sessionId: 'sess-77',
    });

    fireEvent.click(screen.getByRole('alert'));

    expect(navigate).toHaveBeenCalledWith('/workspace');
    expect(store.get(activeWorkspaceIdAtom)).toBe('ws-9');
    expect(store.get(pendingFocusSessionAtom)).toBe('sess-77');
    expect(window.localStorage.length).toBe(0);
  });

  it('clicking a workspace-only toast (no sessionId) navigates but does not set focus marker', () => {
    const store = renderWithToast({
      kind: 'info',
      title: 'Heads up',
      workspaceId: 'ws-3',
    });

    fireEvent.click(screen.getByRole('alert'));

    expect(navigate).toHaveBeenCalledWith('/workspace');
    expect(store.get(activeWorkspaceIdAtom)).toBe('ws-3');
    expect(store.get(pendingFocusSessionAtom)).toBeNull();
  });
});
