import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { TerminalPanel } from '../components/terminal-panel';
import { wsClientAtom } from '../../../atoms/connection';
import { bottomPanelHeightAtom } from '../../workspace/atoms/layout';
import {
  terminalMetaAtomFamily,
  terminalOutputAtomFamily,
  type TerminalMeta,
} from '../atoms/terminals';
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

  it('renders the new terminal immediately from terminal.create result before the created event arrives', async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.list') {
        return Promise.resolve([]);
      }

      if (op === 'terminal.create') {
        return Promise.resolve({
          id: 'term_2',
          workspaceId: 'ws-test',
          kind: 'shell',
          title: 'Workspace Shell',
          cwd: '/tmp/ws-test',
          argv: ['/bin/bash'],
          cols: 120,
          rows: 30,
          alive: true,
          createdAt: 1,
        });
      }

      return Promise.resolve(undefined);
    });

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
      screen.getAllByRole('button', { name: '新建终端' })[0]?.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('xterm-host')).toHaveTextContent('term_2');
    });
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

  it('caches terminal output to atom for shell terminals before xterm-host subscribes', async () => {
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

    // Set terminal meta before output arrives
    const terminalMeta: TerminalMeta = {
      id: 'term_output',
      workspaceId: 'ws-test',
      kind: 'shell',
      alive: true,
      title: 'Shell',
    };
    store.set(terminalMetaAtomFamily('term_output'), terminalMeta);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    // Simulate output event arriving before xterm-host subscribes
    const outputBytes = new TextEncoder().encode('hello from shell\n');
    await act(async () => {
      handlers[0]?.(
        'workspace.ws-test.terminal.term_output.output',
        { transport: 'binary', streamId: 1, size: outputBytes.length, bytes: outputBytes },
        18
      );
    });

    // Verify output is cached in the atom
    const outputState = store.get(terminalOutputAtomFamily('term_output'));
    expect(outputState.chunks).toHaveLength(1);
    expect(outputState.chunks[0]).toEqual(outputBytes);
    expect(outputState.lastSeq).toBe(18);

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
