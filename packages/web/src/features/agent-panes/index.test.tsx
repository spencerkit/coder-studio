import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { AgentPanes } from './index';
import { wsClientAtom } from '../../atoms/connection';
import { workspacesAtom } from '../../atoms/workspaces';
import { sessionsAtom } from '../../atoms/sessions';
import { activeWorkspaceIdAtom, paneLayoutAtomFamily } from '../../atoms/ui';

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
  customSendCommand?: ReturnType<typeof vi.fn>
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

  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(activeWorkspaceIdAtom, 'ws-1');
  store.set(workspacesAtom, {
    'ws-1': {
      id: 'ws-1',
      rootPath: '/tmp/repo',
      gitBranch: 'main',
      name: 'repo',
    },
  } as never);
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

  it('closes only the target pane and collapses the split layout', async () => {
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
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual(
        expect.objectContaining({
          type: 'leaf',
          sessionId: 'sess_2',
        })
      );
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

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
        id: 'right',
        type: 'leaf',
      });
    });
  });

  it('assigns a created session to the draft pane instead of replacing the full layout', async () => {
    const createdSession = {
      id: 'sess_3',
      workspaceId: 'ws-1',
      terminalId: 'term-3',
      providerId: 'codex',
      state: 'starting',
      capability: 'full',
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    const sendCommand = vi.fn(async (op: string) => {
      if (op === 'session.list') {
        return [
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
        ];
      }

      if (op === 'session.create') {
        return createdSession;
      }

      return undefined;
    });
    const { store } = createAgentPaneStore(
      {
        id: 'root',
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { id: 'left', type: 'leaf', sessionId: 'sess_1' },
          { id: 'right', type: 'leaf' },
        ],
      },
      sendCommand
    );

    render(
      <Provider store={store}>
        <AgentPanes />
      </Provider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('session.create', {
        workspaceId: 'ws-1',
        providerId: 'codex',
      });
    });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
        id: 'root',
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { id: 'left', type: 'leaf', sessionId: 'sess_1' },
          { id: 'right', type: 'leaf', sessionId: 'sess_3' },
        ],
      });
    });
  });
});
