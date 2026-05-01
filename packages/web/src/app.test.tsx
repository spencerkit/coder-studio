import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import App from './app';
import { authEnabledAtom, connectionStatusAtom } from './atoms/connection';
import { authenticatedAtom } from './atoms/ui';

vi.mock('./shells/desktop-shell', () => ({
  DesktopShell: () => <div data-testid="desktop-shell">DesktopShell</div>,
}));

vi.mock('./shells/mobile-shell', () => ({
  MobileShell: () => <div data-testid="mobile-shell">MobileShell</div>,
}));

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    matches: predicate(query),
    media: query,
    removeEventListener: vi.fn(),
  }));
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe('App shell selection', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders DesktopShell on a wide viewport with fine pointer', () => {
    setMatchMediaMock(() => false);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('desktop-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });

  it('renders MobileShell when viewport is narrow', () => {
    setMatchMediaMock((query) => query.includes('max-width: 899px'));
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-shell')).not.toBeInTheDocument();
  });

  it('renders MobileShell when pointer is coarse', () => {
    setMatchMediaMock((query) => query.includes('pointer: coarse'));
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
  });
});
