import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localeAtom } from '../../../atoms/app-ui';
import {
  connectionStatusAtom,
  type ConnectionStatus,
  wsClientAtom,
} from '../../../atoms/connection';
import { ProviderSettings, type ProviderInfo } from './provider-settings';

const editorMountSpy = vi.fn();

vi.mock('./config-editor', () => ({
  ConfigEditor: ({
    configType,
    visible = true,
  }: {
    configType: 'claude' | 'codex';
    visible?: boolean;
  }) => {
    const React = require('react') as typeof import('react');
    React.useEffect(() => {
      editorMountSpy(configType);
    }, [configType]);

    return (
      <div
        data-testid={`config-editor-${configType}`}
        data-visible={String(visible)}
      >
        {configType}-editor
      </div>
    );
  },
}));

function createConnectedStore(
  sendCommand: ReturnType<typeof vi.fn>,
  connectionStatus: ConnectionStatus = 'connected'
) {
  const store = createStore();
  store.set(connectionStatusAtom, connectionStatus);
  store.set(localeAtom, 'zh');
  store.set(
    wsClientAtom,
    {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never
  );
  return store;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderHarness({
  isMobile = false,
  connectionStatus = 'connected' as ConnectionStatus,
  sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
    if (op === 'settings.previewCommand') {
      const request = args as { providerId: string; config: { additionalArgs?: string[] } };
      return {
        preview: [request.providerId, ...(request.config.additionalArgs ?? [])].join(' '),
      };
    }
    if (op === 'settings.readConfigFile') {
      return {
        configPath: '/tmp/config.json',
        content: '{}',
        exists: true,
      };
    }
    return {};
  }),
} = {}) {
  const providers: ProviderInfo[] = [
    { id: 'claude', displayName: 'Claude' },
    { id: 'codex', displayName: 'Codex' },
  ];

  function Harness() {
    const [additionalArgsById, setAdditionalArgsById] = useState<Record<string, string>>({
      claude: '--verbose',
      codex: '--sandbox',
    });

    return (
      <ProviderSettings
        providers={providers}
        additionalArgsById={additionalArgsById}
        setAdditionalArgsById={setAdditionalArgsById}
        isMobile={isMobile}
      />
    );
  }

  const store = createConnectedStore(sendCommand, connectionStatus);

  return {
    store,
    ...render(
      <Provider store={store}>
        <Harness />
      </Provider>
    ),
  };
}

describe('ProviderSettings desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to base settings and switches to config files explicitly', async () => {
    renderHarness();

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toHaveValue('--verbose');
    });

    expect(screen.getByRole('button', { name: '基础配置' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('config-editor-claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '配置文件' }));

    expect(screen.getByRole('button', { name: '配置文件' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('config-editor-claude')).toBeInTheDocument();
    expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();
  });

  it('keeps the config-files subview selected when switching providers', async () => {
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: '配置文件' }));
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    expect(screen.getByRole('button', { name: '配置文件' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('config-editor-codex')).toBeInTheDocument();
    expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();
  });

  it('keeps command preview scoped to the provider that requested it', async () => {
    const claudePreview = createDeferred<{ preview: string }>();
    const codexPreview = createDeferred<{ preview: string }>();

    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'settings.previewCommand') {
        const request = args as { providerId: string };
        if (request.providerId === 'claude') {
          return claudePreview.promise;
        }
        if (request.providerId === 'codex') {
          return codexPreview.promise;
        }
      }
      if (op === 'settings.readConfigFile') {
        return {
          configPath: '/tmp/config.json',
          content: '{}',
          exists: true,
        };
      }
      return {};
    });

    renderHarness({ sendCommand });

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    codexPreview.resolve({ preview: 'codex --sandbox' });
    await screen.findByText('codex --sandbox');

    claudePreview.resolve({ preview: 'claude --verbose' });

    await waitFor(() => {
      expect(screen.getByText('codex --sandbox')).toBeInTheDocument();
    });

    expect(screen.queryByText('claude --verbose')).not.toBeInTheDocument();
  });

  it('waits for websocket connection before loading command previews', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'settings.previewCommand') {
        const request = args as { providerId: string; config: { additionalArgs?: string[] } };
        return {
          preview: [request.providerId, ...(request.config.additionalArgs ?? [])].join(' '),
        };
      }
      if (op === 'settings.readConfigFile') {
        return {
          configPath: '/tmp/config.json',
          content: '{}',
          exists: true,
        };
      }
      return {};
    });

    const { store } = renderHarness({
      connectionStatus: 'connecting',
      sendCommand,
    });

    expect(sendCommand).not.toHaveBeenCalled();

    act(() => {
      store.set(connectionStatusAtom, 'connected');
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('settings.previewCommand', {
        providerId: 'claude',
        config: {
          additionalArgs: ['--verbose'],
        },
      }, undefined);
    });

    expect(await screen.findByText('claude --verbose')).toBeInTheDocument();
  });

  it('keeps each provider config editor mounted once after first visit', async () => {
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: '配置文件' }));
    expect(screen.getByTestId('config-editor-claude')).toHaveAttribute('data-visible', 'true');

    fireEvent.click(screen.getByRole('button', { name: '基础配置' }));
    fireEvent.click(screen.getByRole('button', { name: '配置文件' }));

    expect(editorMountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByTestId('config-editor-codex')).toHaveAttribute('data-visible', 'true');
    expect(editorMountSpy).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Claude' }));
    expect(screen.getByTestId('config-editor-claude')).toHaveAttribute('data-visible', 'true');
    expect(editorMountSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ProviderSettings mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to base settings and enters config files from a secondary action', async () => {
    renderHarness({ isMobile: true });

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toHaveValue('--verbose');
    });

    expect(screen.queryByTestId('config-editor-claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /打开配置文件编辑/ }));

    expect(screen.getByTestId('config-editor-claude')).toBeInTheDocument();
    expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回基础配置' }));

    expect(screen.getByLabelText('启动命令参数')).toBeInTheDocument();
  });

  it('returns to base settings when switching providers from the mobile config view', async () => {
    renderHarness({ isMobile: true });

    fireEvent.click(screen.getByRole('button', { name: /打开配置文件编辑/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    await waitFor(() => {
      expect(screen.getByLabelText('启动命令参数')).toHaveValue('--sandbox');
    });

    expect(screen.queryByTestId('config-editor-codex')).not.toBeInTheDocument();
  });
});
