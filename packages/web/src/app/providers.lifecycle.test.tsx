import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
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

function renderProviders() {
  const store = createStore();

  return render(
    <Provider store={store}>
      <AppProviders>
        <div>child</div>
      </AppProviders>
    </Provider>
  );
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

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(wsState.client?.recoverConnection).toHaveBeenCalledWith('visibility_resume');
  });

  it('recovers the websocket when the browser reports network return', () => {
    renderProviders();

    window.dispatchEvent(new Event('online'));

    expect(wsState.client?.recoverConnection).toHaveBeenCalledWith('network_online');
  });
});
