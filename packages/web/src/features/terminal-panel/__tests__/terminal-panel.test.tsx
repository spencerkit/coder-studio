import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { TerminalPanel } from '../components/terminal-panel';
import { wsClientAtom } from '../../../atoms/connection';
import { bottomPanelHeightAtom } from '../../../atoms/ui';
import { terminalMetaAtomFamily, type TerminalMeta } from '../../../atoms/terminals';
import { seedReadyWorkspaceState } from '../../../test-utils/workspace-state';
import { Topics } from '@coder-studio/core';

vi.mock('../components/xterm-host', () => ({
  XtermHost: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="xterm-host">{terminalId}</div>
  ),
}));

type EventHandler = (topic: string, payload: unknown, seq: number) => void;

describe('TerminalPanel', () => {
  let handlers: EventHandler[];

  beforeEach(() => {
    handlers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps rendering when the first terminal is created after mount', async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      'ws-test': {
        id: 'ws-test',
        path: '/tmp/ws-test',
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
    store.set(bottomPanelHeightAtom, 240);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    const terminalMeta: TerminalMeta = {
      id: 'term_1',
      workspaceId: 'ws-test',
      kind: 'shell',
      alive: true,
      title: 'Workspace Shell',
    };
    store.set(terminalMetaAtomFamily('term_1'), terminalMeta);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    expect(screen.getByText('暂无终端')).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledWith(
      [Topics.terminalsAll('ws-test')],
      expect.any(Function)
    );

    await act(async () => {
      handlers[0]?.(
        'workspace.ws-test.terminal.term_1.created',
        { id: 'term_1', kind: 'shell' },
        1
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText('Workspace Shell').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('xterm-host')).toHaveTextContent('term_1');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('ignores agent terminals and keeps the shell panel empty', async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      'ws-test': {
        id: 'ws-test',
        path: '/tmp/ws-test',
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
    store.set(bottomPanelHeightAtom, 240);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    await act(async () => {
      handlers[0]?.(
        'workspace.ws-test.terminal.term_agent.created',
        { id: 'term_agent', kind: 'agent' },
        1
      );
    });

    expect(screen.getByText('暂无终端')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm-host')).not.toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
