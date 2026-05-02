import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { localeAtom } from '../../../atoms/app-ui';
import { TerminalPanel } from '../views/shared/terminal-panel';
import { wsClientAtom } from '../../../atoms/connection';
import { bottomPanelHeightAtom } from '../../workspace/atoms';
import {
  terminalMetaAtomFamily,
  terminalOutputAtomFamily,
  type TerminalMeta,
} from '../atoms';
import { seedReadyWorkspaceState } from '../../../test-utils/workspace-state';
import { Topics } from '@coder-studio/core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../views/shared/xterm-host', () => ({
  XtermHost: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="xterm-host">{terminalId}</div>
  ),
}));

type EventHandler = (topic: string, payload: unknown, seq: number) => void;

describe('TerminalPanel', () => {
  let handlers: EventHandler[];

  beforeEach(() => {
    handlers = [];
    window.localStorage.setItem('ui.locale', JSON.stringify('en'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setEnglishLocale(store: ReturnType<typeof createStore>) {
    store.set(localeAtom, 'en');
  }

  it('keeps rendering when the first terminal is created after mount', async () => {
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
        return Promise.resolve([
          {
            id: 'term_1',
            workspaceId: 'ws-test',
            kind: 'shell',
            title: 'Workspace Shell',
            cwd: '/tmp/ws-test',
            argv: ['/bin/bash'],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
        ]);
      }

      return Promise.resolve([]);
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
    setEnglishLocale(store);
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

    expect(screen.getByText('No terminals')).toBeInTheDocument();
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
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    await act(async () => {
      screen.getAllByRole('button', { name: 'New Terminal' })[0]?.click();
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
    setEnglishLocale(store);
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

    expect(screen.getByText('No terminals')).toBeInTheDocument();
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
    setEnglishLocale(store);
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

  it('renders a lighter mobile fullscreen terminal toolbar when requested by the mobile sheet', async () => {
    const store = createStore();
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
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);
    store.set(terminalMetaAtomFamily('term_1'), {
      id: 'term_1',
      workspaceId: 'ws-test',
      kind: 'shell',
      alive: true,
      title: 'Workspace Shell',
    });

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText('TERMINAL')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace Shell')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New Terminal' }).length).toBeGreaterThan(0);
  });

  it('keeps only one terminal switcher in mobile fullscreen mode', async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.list') {
        return Promise.resolve([
          {
            id: 'term_1',
            workspaceId: 'ws-test',
            kind: 'shell',
            title: 'Workspace Shell',
            cwd: '/tmp/ws-test',
            argv: ['/bin/bash'],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: 'term_2',
            workspaceId: 'ws-test',
            kind: 'shell',
            title: 'Workspace Shell 2',
            cwd: '/tmp/ws-test',
            argv: ['/bin/bash'],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
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
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('xterm-host')).toHaveTextContent('term_1');
    });

    expect(document.querySelectorAll('.terminal-selector-btn')).toHaveLength(1);
    expect(document.querySelector('.bottom-terminal-tabs')).not.toBeInTheDocument();
  });

  it('opens a mobile terminal switcher sheet instead of relying on hover dropdowns', async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === 'terminal.list') {
        return Promise.resolve([
          {
            id: 'term_1',
            workspaceId: 'ws-test',
            kind: 'shell',
            title: 'Workspace Shell',
            cwd: '/tmp/ws-test',
            argv: ['/bin/bash'],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: 'term_2',
            workspaceId: 'ws-test',
            kind: 'shell',
            title: 'Workspace Shell 2',
            cwd: '/tmp/ws-test',
            argv: ['/bin/bash'],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
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
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('xterm-host')).toHaveTextContent('term_1');
    });

    await user.click(screen.getByRole('button', { name: 'Switch terminal' }));

    expect(screen.getByRole('dialog', { name: 'Terminal Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace Shell 2' })).toBeInTheDocument();
    expect(document.querySelector('.terminal-selector-dropdown')).not.toBeInTheDocument();
  });
});
