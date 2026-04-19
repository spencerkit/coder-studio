import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { wsClientAtom } from '../../atoms/connection';
import { workspacesAtom } from '../../atoms/workspaces';
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
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      'ws-test': {
        id: 'ws-test',
        path: '/home/spencer/workspace/coder-studio',
        targetRuntime: 'native',
      },
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace/ws-test']}>
          <Routes>
            <Route path="/workspace/:id" element={<WorkspacePage />} />
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

  it('shows a resolving shell instead of the empty state while the workspace list is still loading', async () => {
    const pendingList = new Promise(() => {});

    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        return pendingList;
      }

      return [];
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {});

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/workspace/ws-pending']}>
          <Routes>
            <Route path="/workspace/:id" element={<WorkspacePage />} />
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
});
