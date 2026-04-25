import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { activeWorkspaceIdAtom } from '../../atoms/ui';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import {
  resolvedActiveWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';
import { activeFilePathAtomFamily } from '../../atoms/fs';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';
import { WorkspacePage } from './index';

vi.mock('../topbar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

vi.mock('../agent-panes', () => ({
  AgentPanes: () => <div data-testid="agent-panes" />,
}));

vi.mock('../terminal-panel', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock('./components/file-tree', () => ({
  FileTreePanel: () => <div data-testid="file-tree-panel" />,
}));

vi.mock('./components/git-panel', () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));

vi.mock('./components/git-diff-viewer', () => ({
  GitDiffViewer: () => <div data-testid="git-diff-viewer" />,
}));

vi.mock('../code-editor', () => ({
  CodeEditorHost: () => <div data-testid="code-editor-host" />,
}));

describe('WorkspacePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads git status on mount so the file view shows the active branch', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return {
          branch: 'feature/refactor-ts',
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      'ws-test': {
        id: 'ws-test',
        path: '/home/spencer/workspace/coder-studio',
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.status', {
        workspaceId: 'ws-test',
      });
    });

    expect(await screen.findByText('feature/refactor-ts')).toBeInTheDocument();
  });

  it('selects the first workspace returned by workspace.list on refresh', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        return [
          {
            id: 'ws-first',
            path: '/tmp/ws-first',
            targetRuntime: 'native',
          },
          {
            id: 'ws-second',
            path: '/tmp/ws-second',
            targetRuntime: 'native',
          },
        ];
      }

      if (op === 'git.status') {
        return {
          branch: 'main',
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.status', {
        workspaceId: 'ws-first',
      });
    });

    expect(store.get(activeWorkspaceIdAtom)).toBeNull();
    expect(store.get(resolvedActiveWorkspaceIdAtom)).toBe('ws-first');
    expect(store.get(workspaceOrderAtom)).toEqual(['ws-first', 'ws-second']);
    expect(store.get(workspacesLoadStateAtom)).toBe('ready');
    expect(store.get(workspacesLoadErrorAtom)).toBeNull();
  });

  it('shows a resolving shell while workspace.list is still loading', async () => {
    const pendingList = new Promise(() => {});

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        return pendingList;
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    expect(screen.getByTestId('workspace-resolving-shell')).toBeInTheDocument();
    expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
  });

  it('shows an error shell instead of the empty state when workspace.list fails', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        throw new Error('Workspace listing failed');
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    expect(await screen.findByText('Workspace listing failed')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-resolving-shell')).not.toBeInTheDocument();
    expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
    expect(store.get(workspacesLoadStateAtom)).toBe('error');
    expect(store.get(workspacesLoadErrorAtom)).toBe('Workspace listing failed');
  });

  it('waits for the websocket connection before requesting workspace.list on refresh', async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);

    const store = createStore();
    store.set(connectionStatusAtom, 'connecting');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await act(async () => {});
    expect(sendCommand).not.toHaveBeenCalledWith('workspace.list', {});
    expect(screen.getByTestId('workspace-resolving-shell')).toBeInTheDocument();
    expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();

    act(() => {
      store.set(connectionStatusAtom, 'connected');
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });
  });

  it('keeps the resolving shell visible while the connection is not yet connected', async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);

    const store = createStore();
    store.set(connectionStatusAtom, 'connecting');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await act(async () => {});
    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace-resolving-shell')).toBeInTheDocument();
    expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
  });
});
