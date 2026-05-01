import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { AgentPanes } from './index';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import { sessionsAtom } from '../../atoms/sessions';
import { activeWorkspaceIdAtom } from '../../atoms/workspaces';
import { localeAtom } from '../../atoms/app-ui';
import { paneLayoutAtomFamily } from '../agent-panes/atoms/pane-layout';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';

const mockSessionCard = vi.fn(
  ({
    sessionId,
    onSplitHorizontal,
    onSplitVertical,
    onStart,
    onStop,
    onClose,
  }: {
    sessionId: string;
    onSplitHorizontal?: () => void;
    onSplitVertical?: () => void;
    onStart?: () => void;
    onStop?: () => void;
    onClose?: () => void;
  }) => (
    <div data-testid="session-card">
      <span>{sessionId}</span>
      <button type="button" onClick={onSplitHorizontal}>
        split-{sessionId}
      </button>
      <button type="button" onClick={onSplitVertical}>
        split-vertical-{sessionId}
      </button>
      <button type="button" onClick={onStart}>
        start-{sessionId}
      </button>
      <button type="button" onClick={onStop}>
        stop-{sessionId}
      </button>
      <button type="button" onClick={onClose}>
        close-{sessionId}
      </button>
    </div>
  )
);

vi.mock('./components/session-card', () => ({
  SessionCard: (props: Record<string, unknown>) => mockSessionCard(props),
}));

vi.mock('./components/pane-layout', () => ({
  PaneLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pane-layout">{children}</div>
  ),
}));

function createAgentPaneStore(
  initialLayout?: unknown,
  customSendCommand?: ReturnType<typeof vi.fn>,
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'rejected' = 'connected'
) {
  const store = createStore();
  const sessions = [
    {
      id: 'sess_1',
      workspaceId: 'ws-1',
      terminalId: 'term-1',
      providerId: 'claude',
      state: 'running',
      capability: 'full',
      startedAt: Date.now() - 10_000,
      lastActiveAt: Date.now() - 1_000,
    },
    {
      id: 'sess_2',
      workspaceId: 'ws-1',
      terminalId: 'term-2',
      providerId: 'codex',
      state: 'idle',
      capability: 'full',
      startedAt: Date.now() - 8_000,
      lastActiveAt: Date.now() - 500,
    },
  ];
  const sendCommand =
    customSendCommand ??
    vi.fn(async (op: string) => {
      if (op === 'session.list') {
        return sessions;
      }

      return undefined;
    });

  store.set(connectionStatusAtom, connectionStatus);
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(activeWorkspaceIdAtom, 'ws-1');
  seedReadyWorkspaceState(store, {
    'ws-1': {
      id: 'ws-1',
      name: 'repo',
      path: '/tmp/repo',
      targetRuntime: 'native',
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(
    sessionsAtom,
    Object.fromEntries(sessions.map((session) => [session.id, session]))
  );
  store.set(
    paneLayoutAtomFamily('ws-1'),
    (initialLayout as never) ?? {
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    }
  );

  return { store, sendCommand, sessions };
}

describe('AgentPanes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits the active session pane when session-card requests a split', async () => {
    const { store } = createAgentPaneStore();

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'split-sess_1' }));

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual(
        expect.objectContaining({
          type: 'split',
          direction: 'horizontal',
          children: [
            expect.objectContaining({ sessionId: 'sess_1' }),
            expect.objectContaining({ type: 'leaf' }),
          ],
        })
      );
    });
  });

  it('closes only the target pane and preserves the split layout as a draft leaf', async () => {
    const { store, sendCommand } = createAgentPaneStore({
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf', sessionId: 'sess_1' },
        { id: 'right', type: 'leaf', sessionId: 'sess_2' },
      ],
    });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'close-sess_1' }));

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
        id: 'root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { id: 'left', type: 'leaf' },
          { id: 'right', type: 'leaf', sessionId: 'sess_2' },
        ],
      });
    });

    expect(sendCommand).toHaveBeenCalledWith('session.stop', { sessionId: 'sess_1' });
  });

  it('keeps the remaining draft pane visible after closing the last session pane', async () => {
    const { store } = createAgentPaneStore({
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        { id: 'left', type: 'leaf', sessionId: 'sess_1' },
        { id: 'right', type: 'leaf' },
      ],
    });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'close-sess_1' }));

    // After close, both panes become draft leaves, split structure is preserved
    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
        id: 'root',
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { id: 'left', type: 'leaf' },
          { id: 'right', type: 'leaf' },
        ],
      });
    });
  });

  it('waits for the websocket connection before requesting session.list', async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);
    const { store } = createAgentPaneStore(undefined, sendCommand, 'connecting');
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {});
    expect(sendCommand).not.toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });

    act(() => {
      store.set(connectionStatusAtom, 'connected');
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });
  });

  it('re-requests session.list after remount when the pane tree mounts again', async () => {
    const sendCommand = vi.fn().mockResolvedValue([
      {
        id: 'sess_1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: Date.now() - 10_000,
        lastActiveAt: Date.now() - 1_000,
      },
    ]);
    const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
    store.set(sessionsAtom, {});

    const { unmount } = render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });

    unmount();
    sendCommand.mockClear();
    mockSessionCard.mockClear();
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });
  });

  it('mounts only the first live session when no pane layout has been persisted yet', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') {
        return [
          {
            id: 'sess_1',
            workspaceId: 'ws-1',
            terminalId: 'term-1',
            providerId: 'claude',
            state: 'interrupted',
            resumeId: 'resume-1',
            capability: 'full',
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
          {
            id: 'sess_2',
            workspaceId: 'ws-1',
            terminalId: 'term-2',
            providerId: 'codex',
            state: 'unavailable',
            capability: 'full',
            startedAt: Date.now() - 8_000,
            lastActiveAt: Date.now() - 500,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: 'root',
        type: 'leaf',
      },
      sendCommand,
      'connected'
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });

    expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    });
    expect(mockSessionCard).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess_1' })
    );
    expect(mockSessionCard).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess_2' })
    );
  });

  it('keeps interrupted sessions mounted in the pane layout after session.list hydration', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') {
        return [
          {
            id: 'sess_1',
            workspaceId: 'ws-1',
            terminalId: 'term-1',
            providerId: 'claude',
            state: 'interrupted',
            resumeId: 'resume-1',
            capability: 'full',
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: 'root',
        type: 'leaf',
        sessionId: 'sess_1',
      },
      sendCommand,
      'connected'
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });

    expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    });
    expect(mockSessionCard).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess_1' })
    );
  });

  it('keeps unavailable sessions mounted in the pane layout after session.list hydration', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') {
        return [
          {
            id: 'sess_1',
            workspaceId: 'ws-1',
            terminalId: 'term-1',
            providerId: 'claude',
            state: 'unavailable',
            capability: 'full',
            startedAt: Date.now() - 10_000,
            lastActiveAt: Date.now() - 1_000,
          },
        ];
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: 'root',
        type: 'leaf',
        sessionId: 'sess_1',
      },
      sendCommand,
      'connected'
    );
    store.set(sessionsAtom, {});

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    });

    expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
      id: 'root',
      type: 'leaf',
      sessionId: 'sess_1',
    });
  });

  it('disables provider buttons while session.create is in flight to prevent re-entry', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'session.create') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (op === 'session.list') {
        return [];
      }
      return undefined;
    });
    const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
    store.set(sessionsAtom, {});
    store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const claudeButton = await screen.findByRole('button', { name: /Claude/i });
    const codexButton = screen.getByRole('button', { name: /Codex/i });

    fireEvent.click(claudeButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.create', {
        workspaceId: 'ws-1',
        providerId: 'claude',
      });
    });

    expect(claudeButton).toBeDisabled();
    expect(codexButton).toBeDisabled();

    fireEvent.click(claudeButton);
    fireEvent.click(codexButton);

    expect(sendCommand.mock.calls.filter(([op]) => op === 'session.create')).toHaveLength(1);

    resolveCreate?.({
      id: 'sess_new',
      workspaceId: 'ws-1',
      terminalId: 'term-new',
      providerId: 'claude',
      state: 'starting',
      capability: 'full',
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)).toHaveProperty('sess_new');
    });
  });

  it('shows install and start CTA when the provider is missing but auto-install is supported', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') return [];
      if (op === 'provider.runtimeStatus') {
        return {
          providers: {
            claude: {
              providerId: 'claude',
              available: false,
              missingCommands: ['claude'],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: 'ready',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
              docUrls: {
                provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
            codex: {
              providerId: 'codex',
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: 'ready',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
              docUrls: {
                provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
          },
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
    store.set(sessionsAtom, {});
    store.set(localeAtom, 'en');
    store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    expect(await screen.findByText('Install & Start')).toBeInTheDocument();
  });

  it('runs install polling and creates the session after install succeeds', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') return [];
      if (op === 'provider.runtimeStatus') {
        return {
          providers: {
            codex: {
              providerId: 'codex',
              available: false,
              missingCommands: ['codex'],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: 'ready',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
              docUrls: {
                provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
            claude: {
              providerId: 'claude',
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: 'ready',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
              docUrls: {
                provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
          },
        };
      }
      if (op === 'provider.install.start') {
        return {
          jobId: 'job-1',
          providerId: 'codex',
          strategyIds: ['npm-install-codex'],
          status: 'running',
          currentStepId: 'install-provider-codex',
          steps: [],
        };
      }
      if (op === 'provider.install.get') {
        return {
          jobId: 'job-1',
          providerId: 'codex',
          strategyIds: ['npm-install-codex'],
          status: 'succeeded',
          steps: [],
        };
      }
      if (op === 'session.create') {
        return {
          id: 'sess_new',
          workspaceId: 'ws-1',
          terminalId: 'term-new',
          providerId: 'codex',
          state: 'starting',
          capability: 'full',
          startedAt: Date.now(),
          lastActiveAt: Date.now(),
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
    store.set(sessionsAtom, {});
    store.set(localeAtom, 'en');
    store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const installCta = await screen.findByText('Install & Start');
    vi.useFakeTimers();

    fireEvent.click(installCta.closest('button')!);

    expect(sendCommand).toHaveBeenCalledWith('provider.install.start', { providerId: 'codex' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(sendCommand).toHaveBeenCalledWith('provider.install.get', { jobId: 'job-1' });
    expect(sendCommand).toHaveBeenCalledWith('session.create', {
      workspaceId: 'ws-1',
      providerId: 'codex',
    });
  });

  it('shows install failure details and docs link when automatic install fails', async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') return [];
      if (op === 'provider.runtimeStatus') {
        return {
          providers: {
            claude: {
              providerId: 'claude',
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: 'ready',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.claude.manual'],
              docUrls: {
                provider: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
            codex: {
              providerId: 'codex',
              available: false,
              missingCommands: ['codex'],
              missingPrerequisites: ['npm'],
              autoInstallSupported: true,
              installReadiness: 'missing_prerequisite',
              manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
              docUrls: {
                provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
                prerequisites: { npm: 'https://nodejs.org/en/download' },
              },
            },
          },
        };
      }
      if (op === 'provider.install.start') {
        return {
          jobId: 'job-failed',
          providerId: 'codex',
          strategyIds: ['winget-nodejs-lts'],
          status: 'running',
          currentStepId: 'install-prerequisite-npm',
          steps: [],
        };
      }
      if (op === 'provider.install.get') {
        return {
          jobId: 'job-failed',
          providerId: 'codex',
          strategyIds: ['winget-nodejs-lts'],
          status: 'failed',
          steps: [],
          failure: {
            code: 'missing_prerequisite',
            providerId: 'codex',
            failedStepId: 'install-prerequisite-npm',
            message: 'Missing prerequisite commands: npm',
            command: '',
            args: [],
            missingCommands: ['npm'],
            manualGuideKeys: ['provider.install.nodejs.manual', 'provider.install.codex.manual'],
            docUrls: {
              provider: 'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
              prerequisites: { npm: 'https://nodejs.org/en/download' },
            },
          },
        };
      }
      return undefined;
    });

    const { store } = createAgentPaneStore(undefined, sendCommand, 'connected');
    store.set(sessionsAtom, {});
    store.set(localeAtom, 'en');
    store.set(paneLayoutAtomFamily('ws-1'), { id: 'root', type: 'leaf' });

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    const installCta = await screen.findByText('Install & Start');
    vi.useFakeTimers();

    fireEvent.click(installCta.closest('button')!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.getByText('Missing prerequisite commands: npm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open official docs' })).toHaveAttribute(
      'href',
      'https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started',
    );
  });
});
