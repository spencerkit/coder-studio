import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { authEnabledAtom } from '../atoms/connection';
import { authenticatedAtom } from '../atoms/app-ui';
import { AppProviders, resetAppProvidersSingletonsForTests } from './providers';

const wsState = vi.hoisted(() => ({
  client: null as {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    recoverConnection: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock('../ws', () => ({
  resolveWsUrl: () => 'ws://127.0.0.1:4173/ws',
  WsClient: vi.fn().mockImplementation(function MockWsClient() {
    return wsState.client;
  }),
}));

vi.mock('../features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
}));

function renderProviders(store = createStore()) {
  const rendered = render(
    <Provider store={store}>
      <AppProviders>
        <div>child</div>
      </AppProviders>
    </Provider>
  );

  return { store, ...rendered };
}

describe('AppProviders lifecycle recovery', () => {
  const originalFetch = globalThis.fetch;
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: false }),
    }) as unknown as typeof fetch;

    wsState.client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      onStatus: vi.fn(() => () => {}),
      getStatus: vi.fn(() => 'disconnected'),
      recoverConnection: vi.fn(),
    };
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      delete (document as Document & { visibilityState?: string }).visibilityState;
    }
  });

  it('recovers the websocket when the page becomes visible again', () => {
    renderProviders();

    return vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    }).then(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(wsState.client?.recoverConnection).toHaveBeenCalledWith('visibility_resume');
    });
  });

  it('recovers the websocket when the browser reports network return', () => {
    renderProviders();

    return vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    }).then(() => {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(wsState.client?.recoverConnection).toHaveBeenCalledWith('network_online');
    });
  });

  it('hydrates authEnabled and authenticated from /auth/status instead of trusting stale local state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const store = createStore();
    store.set(authenticatedAtom, true);

    renderProviders(store);

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });
  });

  it('does not connect or recover the websocket before login when auth is required', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });

    expect(wsState.client?.connect).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));

    expect(wsState.client?.recoverConnection).not.toHaveBeenCalled();
  });

  it('connects the websocket after auth state flips to authenticated', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: false }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(false);
    });

    expect(wsState.client?.connect).not.toHaveBeenCalled();

    store.set(authenticatedAtom, true);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalledTimes(1);
    });
  });

  it('marks the session authenticated when /auth/status confirms an existing server session', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ authEnabled: true, authenticated: true }),
    }) as unknown as typeof fetch;

    const { store } = renderProviders();

    await vi.waitFor(() => {
      expect(store.get(authEnabledAtom)).toBe(true);
      expect(store.get(authenticatedAtom)).toBe(true);
    });
  });
});
