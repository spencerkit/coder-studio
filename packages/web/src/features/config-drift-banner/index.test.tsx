import { render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import { ConfigDriftBanner } from './index';

describe('ConfigDriftBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an explicit error when audit loading fails', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockRejectedValue(new Error('boom'));

    store.set(connectionStatusAtom, 'connected');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <ConfigDriftBanner />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Codex 配置检查不可用')).toBeInTheDocument();
    });

    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
