import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { GitStatus } from '@coder-studio/core';
import { GitPanel } from './git-panel';
import { wsClientAtom } from '../../../atoms/connection';
import { gitBranchListAtomFamily, gitStateAtomFamily } from '../../../atoms/git';

describe('GitPanel', () => {
  const status: GitStatus = {
    branch: 'feature/ai-agent',
    ahead: 0,
    behind: 0,
    staged: [{ path: 'src/auth/AuthGate.tsx' }],
    modified: [{ path: 'src/app/AppController.tsx' }],
    untracked: [{ path: 'tests/supervisor.test.ts' }],
    deleted: [{ path: 'src/legacy/deprecated.ts' }],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders git groups from the first git.status response', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.status', { workspaceId: 'ws-test' });
    });

    expect((await screen.findAllByText('Staged')).length).toBeGreaterThan(0);
    expect(screen.getByText('Changes')).toBeInTheDocument();
    expect(screen.getAllByText('Untracked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deleted').length).toBeGreaterThan(0);
    expect(screen.getByText('AuthGate.tsx')).toBeInTheDocument();
    expect(screen.getByText('AppController.tsx')).toBeInTheDocument();
    expect(screen.getByText('supervisor.test.ts')).toBeInTheDocument();
    expect(screen.getByText('deprecated.ts')).toBeInTheDocument();
  });

  it('loads branch list on mount', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, _args: unknown) => {
      if (op === 'git.status') {
        return status;
      }

      if (op === 'git.branches') {
        return {
          current: 'feature/ai-agent',
          branches: [
            { name: 'feature/ai-agent', isCurrent: true, isRemote: false },
            { name: 'main', isCurrent: false, isRemote: false },
          ],
        };
      }

      if (op === 'git.diff') {
        return {
          diff: 'diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx',
        };
      }

      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.branches', { workspaceId: 'ws-test' });
    });

    expect(store.get(gitBranchListAtomFamily('ws-test')).current).toBe('feature/ai-agent');
  });

  it('requests a diff and emits a workspace diff event when a row is clicked', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'git.status') {
        return status;
      }

      if (op === 'git.diff') {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      return {};
    });
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = await screen.findByText('AuthGate.tsx');
    fireEvent.click(row);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.diff', {
        workspaceId: 'ws-test',
        path: 'src/auth/AuthGate.tsx',
        staged: true,
      });
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'coder-studio:show-diff',
        detail: expect.objectContaining({
          path: 'src/auth/AuthGate.tsx',
        }),
      })
    );
  });

  it('auto-selects the first change when git state is already hydrated', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === 'git.diff') {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitStateAtomFamily('ws-test'), status);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.diff', {
        workspaceId: 'ws-test',
        path: 'src/auth/AuthGate.tsx',
        staged: true,
      });
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'coder-studio:show-diff',
        detail: expect.objectContaining({
          path: 'src/auth/AuthGate.tsx',
        }),
      })
    );
  });

  it('requires confirmation before discarding a single file', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText('AppController.tsx')).closest('.git-row');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle('Discard'));

    expect(screen.getByText('放弃文件更改')).toBeInTheDocument();
    expect(screen.getByText('确定要放弃 “src/app/AppController.tsx” 的更改吗？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(sendCommand).not.toHaveBeenCalledWith('git.discard', {
      workspaceId: 'ws-test',
      paths: ['src/app/AppController.tsx'],
    });
  });

  it('discards a single file only after confirmation', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText('AppController.tsx')).closest('.git-row');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle('Discard'));
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.discard', {
        workspaceId: 'ws-test',
        paths: ['src/app/AppController.tsx'],
      });
    });
  });

  it('shows a discard-all confirmation with the affected file count', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByTitle('Discard All'));

    expect(screen.getByText('放弃所有更改')).toBeInTheDocument();
    expect(screen.getByText('确定要放弃 4 个文件的更改吗？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '放弃' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.discard', {
        workspaceId: 'ws-test',
        paths: [
          'src/auth/AuthGate.tsx',
          'src/app/AppController.tsx',
          'src/legacy/deprecated.ts',
          'tests/supervisor.test.ts',
        ],
      });
    });
  });

  it('allows discarding a staged file after confirmation', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.status') {
        return status;
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    const row = (await screen.findByText('AuthGate.tsx')).closest('.git-row');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByTitle('Discard'));
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.discard', {
        workspaceId: 'ws-test',
        paths: ['src/auth/AuthGate.tsx'],
      });
    });
  });
});
