import { render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionStatusAtom, wsClientAtom } from '../../../atoms/connection';
import { activeWorkspaceIdAtom } from '../../../atoms/ui';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the config drift banner inside settings when codex findings exist', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'settings.get') {
        return {
          externalConfigAudit: {
            codex: {
              configPath: '/home/spencer/.codex/config.toml',
              exists: true,
              findings: [
                {
                  id: 'toml_notify',
                  type: 'toml_notify',
                  severity: 'warn',
                  startLine: 11,
                  endLine: 14,
                  snippet: 'notify = ["agent-notify", "codex"]',
                  message: 'top-level notify conflicts with injected notify',
                },
              ],
            },
          },
        };
      }
      return {};
    });

    store.set(connectionStatusAtom, 'connected');
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Codex 配置冲突（1 项）')).toBeInTheDocument();
    });
  });

  it('shows an explicit error when settings loading fails', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockRejectedValue(new Error('settings exploded'));

    store.set(connectionStatusAtom, 'connected');
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('设置加载失败')).toBeInTheDocument();
    });

    expect(screen.getByText('settings exploded')).toBeInTheDocument();
  });
});
