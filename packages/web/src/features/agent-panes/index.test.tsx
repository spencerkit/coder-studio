import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { AgentPanes } from './index';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import { sessionsAtom } from '../../atoms/sessions';
import { activeWorkspaceIdAtom, paneLayoutAtomFamily } from '../../atoms/ui';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';

const mockSessionCard = vi.fn(({ sessionId }: { sessionId: string }) => (
  <div data-testid="session-card">{sessionId}</div>
));

vi.mock('./components/session-card', () => ({
  SessionCard: (props: { sessionId: string }) => mockSessionCard(props),
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

  it('splits the active session pane when panel-split is dispatched', async () => {
    const { store } = createAgentPaneStore();

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('coder-studio:panel-split', {
          detail: { sessionId: 'sess_1', direction: 'horizontal' },
        })
      );
    });

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

    act(() => {
      window.dispatchEvent(
        new CustomEvent('coder-studio:panel-close', {
          detail: { sessionId: 'sess_1' },
        })
      );
    });

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

    expect(sendCommand).not.toHaveBeenCalledWith('session.stop', expect.anything());
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

    act(() => {
      window.dispatchEvent(
        new CustomEvent('coder-studio:panel-close', {
          detail: { sessionId: 'sess_1' },
        })
      );
    });

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

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {});
    expect(sendCommand).not.toHaveBeenCalledWith('session.list', { workspaceId: 'ws-1' });
    expect(screen.queryByText('SESSION LAUNCHER')).not.toBeInTheDocument();

    act(() => {
      store.set(connectionStatusAtom, 'connected');
    });

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
    expect(mockSessionCard).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    expect(mockSessionCard).not.toHaveBeenCalledWith({ sessionId: 'sess_2' });
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
    expect(mockSessionCard).toHaveBeenCalledWith({ sessionId: 'sess_1' });
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
});
