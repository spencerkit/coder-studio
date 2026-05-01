import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { WorktreeInfo } from '@coder-studio/core';
import { wsClientAtom } from '../../../atoms/connection';
import { WorktreeModal } from './worktree-modal';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
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
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
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

    expect(document.querySelector('.modal-overlay')).toBeTruthy();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });
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

    expect(document.querySelector('.mobile-sheet')).toBeTruthy();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.diff', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(await screen.findByText('diff --git a/src/app.tsx b/src/app.tsx')).toBeInTheDocument();
  });
});
