import { act, render, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import { sessionsAtom } from '../../atoms/sessions';
import { notificationPreferencesAtom } from '../../atoms/ui';
import { toastsAtom } from './atoms';
import { useSessionNotifications } from './use-session-notifications';

const NotificationMock = vi.fn().mockImplementation(() => ({
  close: vi.fn(),
  onclick: null,
}));
(Object.assign(NotificationMock, {
  permission: 'granted',
  requestPermission: vi.fn(),
}) as unknown);

class OscillatorMock {
  type = 'sine';
  frequency = { value: 0 };
  connect(target: unknown) {
    return target;
  }
  start() {}
  stop() {}
}

class GainMock {
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect(target: unknown) {
    return target;
  }
}

class AudioContextMock {
  currentTime = 0;
  destination = {};
  createOscillator() {
    return new OscillatorMock();
  }
  createGain() {
    return new GainMock();
  }
  close() {
    return Promise.resolve();
  }
}

class AudioElementMock {
  volume = 1;
  play() {
    return Promise.resolve();
  }
}

function Harness() {
  useSessionNotifications();
  return null;
}

function createSession(id: string, state: 'running' | 'ended') {
  const now = Date.now();
  return {
    id,
    workspaceId: 'ws-1',
    terminalId: 'term-1',
    providerId: 'codex',
    state,
    capability: 'full' as const,
    startedAt: now - 5_000,
    lastActiveAt: now - 1_000,
    endedAt: state === 'ended' ? now : undefined,
  };
}

describe('useSessionNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Notification', NotificationMock);
    vi.stubGlobal('Audio', AudioElementMock);
    vi.stubGlobal('AudioContext', AudioContextMock);
  });

  it('queues a success toast when a session transitions to ended', async () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'disconnected');
    store.set(notificationPreferencesAtom, {
      enabled: true,
      onlyWhenBackgrounded: false,
    });
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);
    store.set(sessionsAtom, {
      'sess-1': createSession('sess-1', 'running'),
    });

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    act(() => {
      store.set(sessionsAtom, {
        'sess-1': createSession('sess-1', 'ended'),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: 'success',
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
    });
    expect(NotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does not queue a toast when notifications are disabled', async () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'disconnected');
    store.set(notificationPreferencesAtom, {
      enabled: false,
      onlyWhenBackgrounded: false,
    });
    store.set(sessionsAtom, {
      'sess-1': createSession('sess-1', 'running'),
    });

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    act(() => {
      store.set(sessionsAtom, {
        'sess-1': createSession('sess-1', 'ended'),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(0);
    });

    expect(NotificationMock).not.toHaveBeenCalled();
  });
});
