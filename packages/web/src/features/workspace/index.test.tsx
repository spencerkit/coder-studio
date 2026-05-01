import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { activeWorkspaceIdAtom } from '../../atoms/workspaces';
import { terminalPanelVisibleAtom } from './atoms/layout';
import { connectionStatusAtom, wsClientAtom } from '../../atoms/connection';
import {
  resolvedActiveWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
} from '../../atoms/workspaces';
import { activeFilePathAtomFamily } from './atoms/files';
import { branchQuickPickAtom } from './atoms/git';
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';
import { WorkspacePage } from './index';

const fileTreePanelSpy = vi.fn();

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
  FileTreePanel: (props: unknown) => {
    fileTreePanelSpy(props);
    return <div data-testid="file-tree-panel" />;
  },
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
    fileTreePanelSpy.mockReset();
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

  it('opens branch quick pick from the existing branch pill and switches to git tab', async () => {
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

    const branchButton = await screen.findByRole('button', {
      name: 'Open branch switcher for feature/refactor-ts',
    });
    fireEvent.click(branchButton);

    expect(screen.getByRole('button', { name: 'Git Diff' })).toHaveClass('active');
    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: 'ws-test',
      inputValue: '',
    });
  });

  it('shows the empty state when rendered without an active workspace', async () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace']}>
          <Routes>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('未打开工作区')).toBeInTheDocument();
  });

  it('passes toolbar create requests through to the file tree panel', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
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

    expect(await screen.findByRole('button', { name: '新建文件' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建文件' }));

    await waitFor(() => {
      expect(fileTreePanelSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-test',
          createRequest: expect.objectContaining({
            mode: 'file',
            baseDir: null,
          }),
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));

    await waitFor(() => {
      expect(fileTreePanelSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-test',
          createRequest: expect.objectContaining({
            mode: 'folder',
            baseDir: null,
          }),
        })
      );
    });
  });

  it('keeps agent panes mounted when the bottom terminal panel is hidden', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
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
    store.set(terminalPanelVisibleAtom, true);
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

    expect(await screen.findByTestId('agent-panes')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();

    act(() => {
      store.set(terminalPanelVisibleAtom, false);
    });

    expect(screen.getByTestId('agent-panes')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();
  });
});
