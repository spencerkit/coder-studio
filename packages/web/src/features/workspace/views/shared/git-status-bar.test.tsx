import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { GitStatus } from '@coder-studio/core';
import { localeAtom } from '../../../../atoms/app-ui';
import { wsClientAtom } from '../../../../atoms/connection';
import { toastsAtom } from '../../../notifications/atoms';
import { gitStateAtomFamily } from '../../atoms';
import { GitStatusBar } from './git-status-bar';

const baseStatus: GitStatus = {
  branch: 'main',
  ahead: 2,
  behind: 3,
  staged: [{ path: 'src/app.tsx' }],
  modified: [{ path: 'src/main.tsx' }],
  untracked: [],
  deleted: [],
};

function renderStatusBar({
  locale = 'en',
  status = baseStatus,
  sendCommand = vi.fn(),
}: {
  locale?: 'en' | 'zh';
  status?: GitStatus;
  sendCommand?: ReturnType<typeof vi.fn>;
} = {}) {
  const store = createStore();
  store.set(localeAtom, locale);
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(gitStateAtomFamily('ws-test'), status);

  render(
    <Provider store={store}>
      <GitStatusBar workspaceId="ws-test" gitState={status} inline />
    </Provider>
  );

  return { store, sendCommand };
}

describe('GitStatusBar', () => {
  it('confirms and pushes local commits from the status bar', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.push') {
        return { success: true, message: 'Push completed successfully' };
      }

      if (op === 'git.status') {
        return {
          ...baseStatus,
          ahead: 0,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    const { store } = renderStatusBar({ sendCommand });

    fireEvent.click(screen.getByRole('button', { name: 'Push' }));

    expect(screen.getByText('Push Changes')).toBeInTheDocument();
    expect(screen.getByText('Do you want to push 2 local commits to the remote?')).toBeInTheDocument();

    const modal = screen.getByText('Push Changes').closest('.modal-card');
    expect(modal).not.toBeNull();
    fireEvent.click(within(modal as HTMLElement).getByRole('button', { name: 'Push' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('git.push', { workspaceId: 'ws-test' });
      expect(sendCommand).toHaveBeenCalledWith('git.status', { workspaceId: 'ws-test' });
    });

    expect(store.get(gitStateAtomFamily('ws-test'))?.ahead).toBe(0);
    expect(store.get(toastsAtom)[0]?.title).toBe('Push completed');
  });

  it('shows pull confirmation and does not dispatch when cancelled', async () => {
    const sendCommand = vi.fn();

    renderStatusBar({
      locale: 'zh',
      status: {
        ...baseStatus,
        ahead: 0,
        behind: 2,
      },
      sendCommand,
    });

    fireEvent.click(screen.getByRole('button', { name: '拉取' }));

    expect(screen.getByText('拉取更改')).toBeInTheDocument();
    expect(screen.getByText('是否从远端拉取 2 个最新提交到本地？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(sendCommand).not.toHaveBeenCalledWith('git.pull', { workspaceId: 'ws-test' });
  });

  it('renders push and pull actions as disabled when commit counts are zero', () => {
    renderStatusBar({
      status: {
        ...baseStatus,
        ahead: 0,
        behind: 0,
      },
    });

    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
  });
});
