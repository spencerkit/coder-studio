import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import type { GitStatus } from '@coder-studio/core';
import { localeAtom } from '../../../../atoms/app-ui';
import { BranchQuickPick } from './branch-quick-pick';
import {
  branchQuickPickAtom,
  gitBranchListAtomFamily,
} from '../../atoms';
import { wsClientAtom } from '../../../../atoms/connection';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

describe('BranchQuickPick', () => {
  let store: ReturnType<typeof createStore>;
  let sendCommandMock: ReturnType<typeof vi.fn>;

  const gitStatus: GitStatus = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    deleted: [],
  };

  beforeEach(() => {
    store = createStore();
    store.set(localeAtom, 'en');
    sendCommandMock = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'git.checkout') {
        return {
          success: true,
          message: 'ok',
        };
      }

      if (op === 'git.branches') {
        return {
          current: 'main',
          branches: [
            { name: 'main', isCurrent: true, isRemote: false },
            { name: 'feature/auth', isCurrent: false, isRemote: false },
            { name: 'feature/ui', isCurrent: false, isRemote: false },
            { name: 'origin/develop', isCurrent: false, isRemote: true },
          ],
        };
      }

      if (op === 'git.status') {
        return gitStatus;
      }

      return undefined;
    });

    // Mock WebSocket client with sendCommand method
    store.set(wsClientAtom, {
      sendCommand: sendCommandMock,
    } as never);
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: 'ws-test',
      inputValue: '',
    });
    store.set(gitBranchListAtomFamily('ws-test'), {
      current: 'main',
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'feature/auth', isCurrent: false, isRemote: false },
        { name: 'feature/ui', isCurrent: false, isRemote: false },
        { name: 'origin/develop', isCurrent: false, isRemote: true },
      ],
      loading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    viewportMocks.viewport = 'desktop';
  });

  it('filters branches by input text', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );
    expect(input).toBeInTheDocument();

    // Initially shows all branches
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('feature/auth')).toBeInTheDocument();
    expect(screen.getByText('feature/ui')).toBeInTheDocument();
    expect(screen.getByText('origin/develop')).toBeInTheDocument();

    // Filter by "feature"
    fireEvent.change(input, { target: { value: 'feature' } });

    await waitFor(() => {
      expect(screen.getByText('feature/auth')).toBeInTheDocument();
      expect(screen.getByText('feature/ui')).toBeInTheDocument();
      expect(screen.queryByText('main')).not.toBeInTheDocument();
      expect(screen.queryByText('origin/develop')).not.toBeInTheDocument();
    });
  });

  it('renders the shared MobileSelectSheet shell for branch quick pick', () => {
    viewportMocks.viewport = 'mobile';

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    expect(screen.getByRole('region', { name: 'Branch sheet' })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Search branches or create new branch...')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'main' })).toHaveAttribute('data-selected', 'true');
  });

  it('does not keep the current branch selected when mobile focus moves to create branch', async () => {
    viewportMocks.viewport = 'mobile';
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: 'ws-test',
      inputValue: 'm',
    });

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create branch: m' })).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByPlaceholderText('Search branches or create new branch...'), {
      key: 'ArrowDown',
    });

    expect(screen.getByRole('button', { name: 'main' })).toHaveAttribute('data-selected', 'false');
  });

  it('renders localized copy for the mobile branch quick pick', () => {
    viewportMocks.viewport = 'mobile';
    store.set(localeAtom, 'zh');

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    expect(screen.getByRole('region', { name: '分支面板' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索分支或创建新分支...')).toBeInTheDocument();
  });

  it('shows create option for non-existent branch', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    // Type a non-existent branch name
    fireEvent.change(input, { target: { value: 'new-feature' } });

    await waitFor(() => {
      expect(screen.getByText('Create branch: new-feature')).toBeInTheDocument();
    });

    // Should not show create option for existing branch
    fireEvent.change(input, { target: { value: 'main' } });

    await waitFor(() => {
      expect(
        screen.queryByText('Create branch: main')
      ).not.toBeInTheDocument();
    });
  });

  it('checks out branch on Enter key', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    // Select a branch by typing part of its name
    fireEvent.change(input, { target: { value: 'auth' } });

    await waitFor(() => {
      expect(screen.getByText('feature/auth')).toBeInTheDocument();
    });

    // Press Enter to checkout
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'ws-test',
        ref: 'feature/auth',
      });
      expect(sendCommandMock).toHaveBeenCalledWith('git.branches', {
        workspaceId: 'ws-test',
      });
      expect(sendCommandMock).toHaveBeenCalledWith('git.status', {
        workspaceId: 'ws-test',
      });
    });

    // Should close after successful checkout
    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it('requires confirmation before creating a new branch on Enter', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    fireEvent.change(input, { target: { value: 'new-branch' } });

    await waitFor(() => {
      expect(screen.getByText('Create branch: new-branch')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(sendCommandMock).not.toHaveBeenCalledWith('git.checkout', {
      workspaceId: 'ws-test',
      ref: 'new-branch',
      createBranch: true,
    });
    expect(screen.getByText('Confirm create branch: new-branch')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'ws-test',
        ref: 'new-branch',
        createBranch: true,
      });
      expect(sendCommandMock).toHaveBeenCalledWith('git.branches', {
        workspaceId: 'ws-test',
      });
      expect(sendCommandMock).toHaveBeenCalledWith('git.status', {
        workspaceId: 'ws-test',
      });
    });

    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it('keeps the mobile keyboard target on confirm create after tapping create with mixed results', async () => {
    const user = userEvent.setup();
    viewportMocks.viewport = 'mobile';
    store.set(branchQuickPickAtom, {
      visible: true,
      workspaceId: 'ws-test',
      inputValue: 'm',
    });

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText('Search branches or create new branch...');

    await user.click(screen.getByRole('button', { name: 'Create branch: m' }));

    expect(screen.getByRole('button', { name: 'Confirm create branch: m' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'ws-test',
        ref: 'm',
        createBranch: true,
      });
    });

    expect(sendCommandMock).not.toHaveBeenCalledWith('git.checkout', {
      workspaceId: 'ws-test',
      ref: 'main',
    });
  });

  it('navigates with arrow keys', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    // First branch is selected by default
    const firstItem = screen.getByText('main').closest('.branch-quick-pick-item');
    expect(firstItem).toHaveClass('branch-quick-pick-item-selected');

    // Press ArrowDown to select next branch
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      const secondItem = screen
        .getByText('feature/auth')
        .closest('.branch-quick-pick-item');
      expect(secondItem).toHaveClass('branch-quick-pick-item-selected');
      expect(firstItem).not.toHaveClass('branch-quick-pick-item-selected');
    });

    // Press ArrowUp to go back
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    await waitFor(() => {
      expect(firstItem).toHaveClass('branch-quick-pick-item-selected');
    });
  });

  it('closes on Escape key', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    fireEvent.keyDown(input, { key: 'Escape' });

    // Wait for state update using act
    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it('closes when clicking overlay', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const overlay = document.querySelector('.branch-quick-pick-overlay');
    expect(overlay).toBeTruthy();

    if (overlay) {
      fireEvent.click(overlay);
    }

    // Wait for state update
    await waitFor(() => {
      expect(store.get(branchQuickPickAtom).visible).toBe(false);
    });
  });

  it('shows loading state while branches are loading', () => {
    store.set(gitBranchListAtomFamily('ws-test'), {
      current: '',
      branches: [],
      loading: true,
    });

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    expect(screen.getByText('Loading branches...')).toBeInTheDocument();
  });

  it('shows all branches when input is empty', async () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('feature/auth')).toBeInTheDocument();
    expect(screen.getByText('feature/ui')).toBeInTheDocument();
    expect(screen.getByText('origin/develop')).toBeInTheDocument();
  });

  it('shows current branch indicator', () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    // The current branch should have a check icon
    const mainBranchItem = screen.getByText('main').closest('.branch-quick-pick-item');
    expect(mainBranchItem).toBeInTheDocument();
    // Check icon is rendered within the selected item
    expect(mainBranchItem?.querySelector('.branch-quick-pick-check')).toBeTruthy();
  });

  it('shows remote badge for remote branches', () => {
    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    // Remote branch should show "Remote" badge
    const remoteBranchItem = screen
      .getByText('origin/develop')
      .closest('.branch-quick-pick-item');
    expect(remoteBranchItem).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
  });

  it('does not render when not visible', () => {
    store.set(branchQuickPickAtom, {
      visible: false,
      inputValue: '',
    });

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    expect(
      screen.queryByPlaceholderText('Search branches or create new branch...')
    ).not.toBeInTheDocument();
  });

  it('handles checkout failure gracefully', async () => {
    sendCommandMock.mockRejectedValueOnce(new Error('Checkout failed'));

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    fireEvent.change(input, { target: { value: 'feature/auth' } });

    await waitFor(() => {
      expect(screen.getByText('feature/auth')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'ws-test',
        ref: 'feature/auth',
      });
    });

    // Should remain open on failure
    expect(store.get(branchQuickPickAtom).visible).toBe(true);
  });

  it('keeps quick pick open when git.checkout returns success false in payload', async () => {
    sendCommandMock.mockImplementationOnce(async (op: string) => {
      if (op === 'git.checkout') {
        return {
          success: false,
          message: 'Checkout blocked by local changes',
        };
      }

      return undefined;
    });

    render(
      <Provider store={store}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText(
      'Search branches or create new branch...'
    );

    fireEvent.change(input, { target: { value: 'feature/auth' } });

    await waitFor(() => {
      expect(screen.getByText('feature/auth')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'ws-test',
        ref: 'feature/auth',
      });
    });

    expect(store.get(branchQuickPickAtom).visible).toBe(true);
  });
});
