import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionStatusAtom, wsClientAtom } from '../../../atoms/connection';
import { SettingsPage } from './settings-page';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.navigate.mockReset();
    viewportMocks.viewport = 'desktop';
    window.history.replaceState({}, '', '/settings');
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

  it('does not render default Agent Provider selection in general settings', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'settings.get') {
        return {
          defaultProviderId: 'codex',
        };
      }
      return {};
    });

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.get', {});
    });

    expect(screen.queryByText('选择默认的 Agent Provider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claude' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Codex' })).not.toBeInTheDocument();
  });

  it('does not render the MCP Servers settings section', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'settings.get') {
        return {};
      }
      return {};
    });

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.get', {});
    });

    expect(screen.queryByRole('button', { name: 'MCP Servers' })).not.toBeInTheDocument();
  });

  it('uses provider-specific startup command args without working directory override', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'settings.get') {
        return {
          'providers.claude.additionalArgs': ['--verbose'],
          'providers.codex.additionalArgs': ['-c', 'model_reasoning_effort="low"'],
        };
      }
      if (op === 'settings.previewCommand') {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ['preview', ...(previewArgs.config.additionalArgs ?? [])].join(' '),
        };
      }
      return {};
    });

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Working Directory Override')).not.toBeInTheDocument();

    const argsInput = screen.getByLabelText('启动命令参数');
    expect(argsInput).toHaveValue('--verbose');
    expect(argsInput).toHaveClass('settings-provider-args-input');

    fireEvent.change(argsInput, {
      target: {
        value: '--verbose\n--debug\n\n--print',
      },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.update', {
        settings: {
          providers: {
            claude: {
              additionalArgs: ['--verbose', '--debug', '--print'],
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.previewCommand', {
        providerId: 'claude',
        config: {
          additionalArgs: ['--verbose', '--debug', '--print'],
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toHaveValue('-c\nmodel_reasoning_effort=\"low\"');
    });

    fireEvent.change(screen.getByLabelText('启动命令参数'), {
      target: {
        value: '--sandbox\n--full-auto',
      },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.update', {
        settings: {
          providers: {
            codex: {
              additionalArgs: ['--sandbox', '--full-auto'],
            },
          },
        },
      });
    });

    expect(screen.queryByLabelText('Working Directory Override')).not.toBeInTheDocument();
  });

  it('returns to /workspace from settings', async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({});

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(routerMocks.navigate).toHaveBeenCalledWith('/workspace');
  });

  it('renders a mobile category list and returns from detail content to the settings root', async () => {
    viewportMocks.viewport = 'mobile';
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'settings.get') {
        return {
          'providers.claude.additionalArgs': ['--verbose'],
        };
      }
      if (op === 'settings.previewCommand') {
        const previewArgs = args as { config: { additionalArgs?: string[] } };
        return {
          preview: ['preview', ...(previewArgs.config.additionalArgs ?? [])].join(' '),
        };
      }
      return {};
    });

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByRole('button', { name: 'Providers' })).toBeInTheDocument();
    expect(document.querySelector('.settings-sidebar')).toBeNull();
    expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByRole('button', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();
  });

  it('prefers browser history when leaving the mobile settings root', async () => {
    viewportMocks.viewport = 'mobile';
    window.history.pushState({ idx: 1 }, '', '/settings');

    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({});

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
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(routerMocks.navigate).toHaveBeenCalledWith(-1);
  });
});
