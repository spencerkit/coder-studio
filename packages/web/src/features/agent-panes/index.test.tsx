import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
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

function createAgentPaneStore(initialLayout?: unknown) {
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
  const sendCommand = vi.fn(async (op: string) => {
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

  return { store, sendCommand };
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

  it('does not resurrect a closed session pane when only a draft pane remains', async () => {
    const { store, sendCommand } = createAgentPaneStore({
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
      expect(
        sendCommand.mock.calls.filter(([op]) => op === 'session.list').length
      ).toBeGreaterThan(1);
    });

    await waitFor(() => {
      expect(store.get(paneLayoutAtomFamily('ws-1'))).toEqual({
        id: 'right',
        type: 'leaf',
      });
    });
  });
});
