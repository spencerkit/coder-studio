import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import App from './app';
import { authEnabledAtom, connectionStatusAtom } from './atoms/connection';
import { authenticatedAtom } from './atoms/ui';

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

describe('App auth gating', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/workspace/ws-123');
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
  });
});
