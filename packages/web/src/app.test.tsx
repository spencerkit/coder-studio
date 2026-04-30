import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import App from './app';
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from './atoms/connection';
import { authenticatedAtom } from './atoms/ui';
import { workspaceOrderAtom, workspacesAtom, workspacesLoadStateAtom } from './atoms/workspaces';

vi.mock('./features/welcome', () => ({
  WelcomePage: () => <div>WelcomePage</div>,
}));

vi.mock('./features/settings', () => ({
  SettingsPage: () => <div>SettingsPage</div>,
}));

vi.mock('./features/workspace', () => ({
  WorkspacePage: () => <div>WorkspacePage</div>,
}));

vi.mock('./features/command-palette', () => ({
  CommandPalette: () => null,
}));

vi.mock('./features/auth', () => ({
  LoginPage: () => <div>LoginPage</div>,
}));

vi.mock('./features/config-drift-banner', () => ({
  ConfigDriftBanner: () => null,
}));

vi.mock('./features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
  ToastContainer: () => null,
}));

const originalFetch = globalThis.fetch;

describe('App auth gating', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows a loading shell while auth status is still unknown', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByText('正在连接工作区...')).toBeInTheDocument();
    expect(screen.queryByText('LoginPage')).not.toBeInTheDocument();
  });

  it('shows login only when auth is enabled and user is unauthenticated', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByText('LoginPage')).toBeInTheDocument();
    expect(screen.queryByText('WelcomePage')).not.toBeInTheDocument();
  });

  it('renders WorkspacePage on /workspace', () => {
    window.history.replaceState({}, '', '/workspace');

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByText('WorkspacePage')).toBeInTheDocument();
  });

  it('renders the explicit /auth route when auth is enabled and user is unauthenticated', () => {
    window.history.replaceState({}, '', '/auth');

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByText('LoginPage')).toBeInTheDocument();
  });

  it('redirects / to /workspace after auth resolves and workspace.list is non-empty', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        return [{ id: 'ws-1', path: '/tmp/ws-1', targetRuntime: 'native' }];
      }
      return [];
    });
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/workspace');
    });
  });

  it('keeps / on WelcomePage after auth resolves and workspace.list is empty', async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });

  it('redirects /workspace back to / when auth resolves and workspace.list is empty', async () => {
    window.history.replaceState({}, '', '/workspace');
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });
});
