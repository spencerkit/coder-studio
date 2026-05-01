import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider, createStore } from 'jotai';
import { MobileShell } from './index';
import {
  authEnabledAtom,
  connectionStatusAtom,
  reconnectAttemptCountAtom,
  wsClientAtom,
} from '../../atoms/connection';
import { sessionsAtom } from '../../atoms/sessions';
import {
  activeWorkspaceIdAtom,
  authenticatedAtom,
  commandPaletteOpenAtom,
  paneLayoutAtomFamily,
  pendingFocusSessionAtom,
} from '../../atoms/ui';
import { supervisorsAtom, supervisorCyclesAtom } from '../../features/supervisor/atoms';
import { workspacesLoadErrorAtom, workspacesLoadStateAtom } from '../../atoms/workspaces';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';
import type { Session } from '@coder-studio/core';

vi.mock('../../features/welcome', () => ({
  WelcomePage: () => <div>WelcomePage</div>,
}));

vi.mock('../../features/settings', () => ({
  SettingsPage: () => <div>SettingsPage</div>,
}));

vi.mock('../../features/workspace', () => ({
  WorkspacePage: () => <div>WorkspacePage</div>,
}));

vi.mock('../../features/command-palette', () => ({
  CommandPalette: () => null,
}));

vi.mock('../../features/workspace/components/branch-quick-pick', () => ({
  BranchQuickPick: () => null,
}));

vi.mock('../../features/auth', () => ({
  LoginPage: () => <div>LoginPage</div>,
}));

vi.mock('../../features/config-drift-banner', () => ({
  ConfigDriftBanner: () => null,
}));

vi.mock('../../features/agent-panes', () => ({
  AgentPanes: () => <div data-testid="agent-panes-empty-mock">AgentPanes</div>,
}));

vi.mock('../../features/agent-panes/components/session-card', () => ({
  SessionCard: ({
    sessionId,
    showHeaderActions,
    showSupervisorInline,
    terminalReadOnlyOverride,
  }: {
    sessionId: string;
    showHeaderActions?: boolean;
    showSupervisorInline?: boolean;
    terminalReadOnlyOverride?: boolean;
  }) => (
    <div
      data-testid="mobile-session-card"
      data-show-header-actions={String(showHeaderActions)}
      data-show-supervisor-inline={String(showSupervisorInline)}
      data-readonly={String(terminalReadOnlyOverride)}
    >
      {sessionId}
    </div>
  ),
}));

vi.mock('../../features/workspace/components/file-tree', () => ({
  FileTreePanel: ({ onSelectFile }: { onSelectFile?: (path: string) => void }) => (
    <button type="button" onClick={() => onSelectFile?.('src/app.tsx')}>
      mock-file-tree
    </button>
  ),
}));

vi.mock('../../features/workspace/components/git-panel', () => ({
  GitPanel: ({
    onPreviewChange,
  }: {
    onPreviewChange?: (preview: { path: string; diff: string; staged: boolean }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onPreviewChange?.({
          path: 'src/app.tsx',
          diff: 'diff --git a/src/app.tsx b/src/app.tsx',
          staged: false,
        })
      }
    >
      mock-git-panel
    </button>
  ),
}));

vi.mock('../../features/workspace/components/git-diff-viewer', () => ({
  GitDiffViewer: () => <div data-testid="mobile-git-diff-viewer">GitDiffViewer</div>,
}));

vi.mock('../../features/code-editor', () => ({
  CodeEditorHost: () => <div data-testid="mobile-code-editor">CodeEditorHost</div>,
}));

vi.mock('../../features/terminal-panel', () => ({
  TerminalPanel: () => <div data-testid="mobile-terminal-panel">TerminalPanel</div>,
}));

vi.mock('../../features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
  ToastContainer: () => null,
}));

function createSession(partial: Partial<Session> & Pick<Session, 'id' | 'terminalId' | 'providerId'>): Session {
  return {
    id: partial.id,
    workspaceId: partial.workspaceId ?? 'ws-1',
    terminalId: partial.terminalId,
    providerId: partial.providerId,
    state: partial.state ?? 'idle',
    capability: partial.capability ?? 'full',
    startedAt: partial.startedAt ?? Date.now() - 10_000,
    lastActiveAt: partial.lastActiveAt ?? Date.now() - 1_000,
    title: partial.title,
    endedAt: partial.endedAt,
    completionPercent: partial.completionPercent,
    errorReason: partial.errorReason,
    resumeId: partial.resumeId,
    transcriptPath: partial.transcriptPath,
  };
}

function installVisualViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<EventListener>>();
  const visualViewport = {
    height,
    offsetTop,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      const event = new Event(type);
      listeners.get(type)?.forEach((listener) => listener(event));
    },
  };

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: 800,
  });

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: visualViewport,
  });

  return visualViewport;
}

function installMatchMediaMock(predicate: (query: string) => boolean) {
  const originalMatchMedia = window.matchMedia;
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();

  window.matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      const key = `${query}:${type}`;
      const bucket = listeners.get(key) ?? new Set<(event: MediaQueryListEvent) => void>();
      bucket.add(listener);
      listeners.set(key, bucket);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.get(`${query}:${type}`)?.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

function renderMobileShell({
  initialEntry = '/workspace',
  withWorkspaces = true,
  connectionStatus = 'connected' as 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'rejected',
  reconnectAttempts = 0,
  sessions = [
    createSession({
      id: 'sess_1',
      terminalId: 'term-1',
      providerId: 'claude',
      state: 'idle',
      lastActiveAt: Date.now() - 5_000,
      title: 'Claude',
    }),
    createSession({
      id: 'sess_2',
      terminalId: 'term-2',
      providerId: 'codex',
      state: 'running',
      lastActiveAt: Date.now() - 500,
      title: 'Codex',
    }),
  ],
  paneLayout = {
    id: 'root',
    type: 'split' as const,
    direction: 'horizontal' as const,
    children: [
      { id: 'left', type: 'leaf' as const, sessionId: 'sess_1' },
      { id: 'right', type: 'leaf' as const, sessionId: 'sess_2' },
    ],
  },
  sendCommand = vi.fn(async (op: string) => {
    if (op === 'session.list') {
      return sessions;
    }

    if (op === 'supervisor.get') {
      return {
        supervisor: {
          id: 'sup-1',
          sessionId: 'sess_2',
          workspaceId: 'ws-1',
          objective: 'Ship mobile phase 3',
          evaluatorProviderId: 'claude',
          state: 'idle',
          cycles: [
            {
              id: 'cycle-1',
              supervisorId: 'sup-1',
              trigger: 'manual',
              status: 'completed',
              result: 'cycle 1/1',
              createdAt: Date.now() - 5_000,
              completedAt: Date.now() - 1_000,
            },
          ],
        },
      };
    }

    return undefined;
  }),
  sendTerminalInput = vi.fn().mockResolvedValue(undefined),
}: {
  initialEntry?: string;
  withWorkspaces?: boolean;
  sessions?: Session[];
  paneLayout?: {
    id: string;
    type: 'leaf' | 'split';
    direction?: 'horizontal' | 'vertical';
    children?: Array<{ id: string; type: 'leaf' | 'split'; sessionId?: string }>;
    sessionId?: string;
  };
  sendCommand?: ReturnType<typeof vi.fn>;
  sendTerminalInput?: ReturnType<typeof vi.fn>;
} = {}) {
  const store = createStore();
  store.set(connectionStatusAtom, connectionStatus);
  store.set(reconnectAttemptCountAtom, reconnectAttempts);
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);
  store.set(wsClientAtom, {
    sendCommand,
    sendTerminalInput,
    subscribe: vi.fn(() => () => {}),
  } as never);
  if (withWorkspaces) {
    seedReadyWorkspaceState(store, {
      'ws-1': {
        id: 'ws-1',
        name: 'Alpha',
        path: '/tmp/alpha',
        targetRuntime: 'native',
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          activeSessionId: 'sess_2',
        },
      },
      'ws-2': {
        id: 'ws-2',
        name: 'Beta',
        path: '/tmp/beta',
        targetRuntime: 'native',
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(sessionsAtom, Object.fromEntries(sessions.map((session) => [session.id, session])));
    store.set(paneLayoutAtomFamily('ws-1'), paneLayout as never);
    store.set(
      supervisorsAtom,
      new Map([
        [
          'sess_2',
          {
            id: 'sup-1',
            sessionId: 'sess_2',
            workspaceId: 'ws-1',
            objective: 'Ship mobile phase 3',
            evaluatorProviderId: 'claude',
            state: 'idle',
            cycles: [
              {
                id: 'cycle-1',
                supervisorId: 'sup-1',
                trigger: 'manual',
                status: 'completed',
                result: 'cycle 1/1',
                createdAt: Date.now() - 5_000,
                completedAt: Date.now() - 1_000,
              },
            ],
          },
        ],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          'sup-1',
          [
            {
              id: 'cycle-1',
              supervisorId: 'sup-1',
              trigger: 'manual',
              status: 'completed',
              result: 'cycle 1/1',
              createdAt: Date.now() - 5_000,
              completedAt: Date.now() - 1_000,
            },
          ],
        ],
      ])
    );
  }

  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MobileShell />
      </MemoryRouter>
    </Provider>
  );

  return { store, sendCommand, sendTerminalInput, ...view };
}

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: undefined,
  });
  vi.unstubAllGlobals();
});

describe('MobileShell Phase 2 workspace', () => {
  it('renders mobile workspace chrome on /workspace', async () => {
    renderMobileShell({ initialEntry: '/workspace' });

    expect(screen.getByRole('button', { name: 'Switch workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files sheet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Terminal sheet' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: 'Mobile agents' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Switch to agent Claude' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to agent Codex' })).toBeInTheDocument();
    expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_2');
    expect(screen.getByRole('textbox', { name: 'Agent composer' })).toBeInTheDocument();
  });

  it('opens and closes the files sheet', async () => {
    const user = userEvent.setup();
    renderMobileShell({ initialEntry: '/workspace' });

    await user.click(screen.getByRole('button', { name: 'Open Files sheet' }));

    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close current sheet' }));

    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument();
  });

  it('opens the workspace drawer and switches active workspace', async () => {
    const user = userEvent.setup();
    const { store } = renderMobileShell({ initialEntry: '/workspace' });

    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await user.click(screen.getByRole('button', { name: 'Switch to workspace Beta' }));

    expect(store.get(activeWorkspaceIdAtom)).toBe('ws-2');
  });

  it('opens quick actions from the topbar menu', async () => {
    const user = userEvent.setup();
    const { store } = renderMobileShell({ initialEntry: '/workspace' });

    await user.click(screen.getByRole('button', { name: 'Open more actions' }));
    await user.click(screen.getByRole('button', { name: 'Open quick actions' }));

    expect(store.get(commandPaletteOpenAtom)).toBe(true);
  });

  it('keeps welcome route as full-page content outside the workspace scaffold', () => {
    renderMobileShell({ initialEntry: '/', withWorkspaces: false });

    expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).not.toBeInTheDocument();
  });

  it('shows a loading workspace gate instead of the mobile scaffold while workspaces are still loading', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesLoadStateAtom, 'loading');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Loading workspaces')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });

  it('shows a workspace load error gate instead of the mobile scaffold when bootstrap fails', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesLoadStateAtom, 'error');
    store.set(workspacesLoadErrorAtom, 'Failed to fetch workspace list');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Failed to load workspaces')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });

  it('does not render the mobile scaffold before redirecting home when /workspace resolves to an empty workspace list', async () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
    expect(screen.queryByText('No active workspace')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });

  it('redirects /workspace home on mobile when the workspace list is ready but empty while reconnecting', async () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'reconnecting');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText('Loading workspaces')).not.toBeInTheDocument();
    expect(screen.queryByText('No active workspace')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });

  it('shows the global reconnecting banner on non-workspace mobile routes', () => {
    renderMobileShell({
      initialEntry: '/settings',
      connectionStatus: 'reconnecting',
      withWorkspaces: false,
    });

    expect(screen.getByText('正在重新连接...')).toBeInTheDocument();
  });

  it('switches the active session when a chip is tapped', async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(await screen.findByRole('button', { name: 'Switch to agent Claude' }));

    expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_1');
  });

  it('switches to the target session when a pending focus marker points at a non-active mobile session', async () => {
    const { store } = renderMobileShell({ initialEntry: '/workspace' });

    expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_2');

    store.set(pendingFocusSessionAtom, 'sess_1');

    await waitFor(() => {
      expect(screen.getByTestId('mobile-session-card')).toHaveTextContent('sess_1');
    });
  });

  it('submits composer text through sendTerminalInput', async () => {
    const user = userEvent.setup();
    const { sendTerminalInput } = renderMobileShell();

    const composer = await screen.findByRole('textbox', { name: 'Agent composer' });
    fireEvent.change(composer, { target: { value: 'ship it' } });
    expect(composer).toHaveValue('ship it');

    const sendButton = screen.getByRole('button', { name: 'Send prompt' });
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled();
    });
    await user.click(sendButton);

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledWith(
        'term-2',
        new TextEncoder().encode('ship it\r'),
        'submit',
        'ship it'
      );
    });
  });

  it('falls back to the agent empty state when no sessions are open', async () => {
    renderMobileShell({
      sessions: [],
      paneLayout: {
        id: 'root',
        type: 'leaf',
      },
      sendCommand: vi.fn(async (op: string) => {
        if (op === 'session.list') {
          return [];
        }

        return undefined;
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('mobile-agent-empty')).toBeInTheDocument();
    });
  });

  it('applies visualViewport inset to the bottom control stack', async () => {
    installVisualViewport(560);
    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId('mobile-bottom-stack')).toHaveStyle({ '--mobile-keyboard-inset': '240px' });
    });
  });

  it('switches the workspace shell into landscape compact mode on short landscape viewports', async () => {
    const restoreMatchMedia = installMatchMediaMock((query) => {
      if (query.includes('orientation: landscape')) {
        return true;
      }

      if (query.includes('max-height: 540px')) {
        return true;
      }

      return false;
    });

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId('mobile-shell')).toHaveAttribute('data-layout-mode', 'landscape-compact');
    });

    restoreMatchMedia();
  });

  it('marks the shell as reduced-motion when the browser prefers reduced motion', async () => {
    const restoreMatchMedia = installMatchMediaMock((query) => {
      if (query.includes('prefers-reduced-motion: reduce')) {
        return true;
      }

      return false;
    });

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId('mobile-shell')).toHaveAttribute('data-motion-mode', 'reduced');
    });

    restoreMatchMedia();
  });

  it('keeps the shell in default motion mode when reduced motion is not requested', async () => {
    const restoreMatchMedia = installMatchMediaMock(() => false);

    renderMobileShell();

    await waitFor(() => {
      expect(screen.getByTestId('mobile-shell')).toHaveAttribute('data-layout-mode', 'default');
      expect(screen.getByTestId('mobile-shell')).toHaveAttribute('data-motion-mode', 'default');
    });

    restoreMatchMedia();
  });

  it('opens the files sheet and navigates from file list into the editor view', async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole('button', { name: 'Open Files sheet' }));
    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'mock-file-tree' }));
    expect(screen.getByTestId('mobile-code-editor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByRole('button', { name: 'mock-file-tree' })).toBeInTheDocument();
  });

  it('switches to the git tab and navigates into the diff viewer', async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole('button', { name: 'Open Files sheet' }));
    await user.click(screen.getByRole('tab', { name: 'Git Diff' }));
    await user.click(screen.getByRole('button', { name: 'mock-git-panel' }));

    expect(screen.getByTestId('mobile-git-diff-viewer')).toBeInTheDocument();
  });

  it('opens the terminal sheet from the dock', async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole('button', { name: 'Open Terminal sheet' }));

    expect(screen.getByTestId('mobile-terminal-panel')).toBeInTheDocument();
  });

  it('shows a supervisor badge for the active session and opens the supervisor sheet', async () => {
    const user = userEvent.setup();
    renderMobileShell();

    expect(await screen.findByRole('button', { name: 'Open Supervisor sheet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Supervisor sheet' }));

    expect(screen.getByRole('region', { name: 'Supervisor sheet' })).toBeInTheDocument();
  });

  it('renders a reconnecting banner inside the mobile workspace scaffold', async () => {
    renderMobileShell({
      connectionStatus: 'reconnecting',
      reconnectAttempts: 2,
    });

    expect(await screen.findByText('正在重新连接...')).toBeInTheDocument();
  });
});
