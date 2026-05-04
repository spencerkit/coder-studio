import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { WorktreeInfo } from '@coder-studio/core';
import { localeAtom } from '../../../../atoms/app-ui';
import { wsClientAtom } from '../../../../atoms/connection';
import { activeWorkspaceIdAtom } from '../../../../atoms/workspaces';
import { WorktreeModal } from './worktree-modal';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

const worktree: WorktreeInfo = {
  name: 'feature/mobile-sheet',
  path: '/tmp/coder-studio-feature',
  branch: 'feature/mobile-sheet',
  commit: 'abc1234',
  status: 'dirty',
};

describe('WorktreeModal', () => {
  afterEach(() => {
    viewportMocks.viewport = 'desktop';
    vi.restoreAllMocks();
  });

  it('keeps the centered modal shell on desktop viewports', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: 'feature/mobile-sheet',
        ahead: 0,
        behind: 0,
        headSha: 'abc1234567890',
        headShortSha: 'abc1234',
        headSubject: 'Initial mobile sheet setup',
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    store.set(localeAtom, 'en');
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        workspaceId: 'ws-1',
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(document.querySelector('.modal-overlay')).toBeTruthy();
    expect(document.querySelector('.mobile-sheet')).toBeNull();
    expect(screen.getByText('Latest Commit')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('Initial mobile sheet setup')).toBeInTheDocument();
  });

  it('renders inside MobileSheet on mobile and still loads data when tabs change', async () => {
    viewportMocks.viewport = 'mobile';
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'worktree.status') {
        return {
          status: {
            branch: 'feature/mobile-sheet',
            ahead: 0,
            behind: 0,
            headSha: 'abc1234567890',
            headShortSha: 'abc1234',
            headSubject: 'Initial mobile sheet setup',
            staged: [],
            modified: [{ path: 'src/app.tsx' }],
            untracked: [],
            deleted: [],
          },
        };
      }

      if (op === 'worktree.diff') {
        return {
          diff: 'diff --git a/src/app.tsx b/src/app.tsx',
        };
      }

      if (op === 'worktree.tree') {
        return {
          tree: [],
        };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, 'en');
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        workspaceId: 'ws-1',
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(document.querySelector('.mobile-sheet')).toBeTruthy();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.diff', {
        workspaceId: 'ws-1',
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(await screen.findByText('diff --git a/src/app.tsx b/src/app.tsx')).toBeInTheDocument();
  });

  it('renders translated Chinese worktree chrome when locale is zh', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: 'feature/mobile-sheet',
        ahead: 0,
        behind: 0,
        headSha: 'abc1234567890',
        headShortSha: 'abc1234',
        headSubject: '初始移动端面板',
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    store.set(localeAtom, 'zh');
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        workspaceId: 'ws-1',
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(screen.getByRole('button', { name: '状态' })).toBeInTheDocument();
    expect(screen.getByText('路径')).toBeInTheDocument();
    expect(screen.getByText('最新提交')).toBeInTheDocument();
    expect(screen.getByText('初始移动端面板')).toBeInTheDocument();
    expect(screen.getByText('● 有更改')).toBeInTheDocument();
  });
});
