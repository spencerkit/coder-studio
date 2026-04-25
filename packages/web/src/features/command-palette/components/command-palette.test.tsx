import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Workspace } from '@coder-studio/core';
import { localeAtom, commandPaletteOpenAtom, activeWorkspaceIdAtom } from '../../../atoms/ui';
import { workspaceOrderAtom, workspacesAtom, workspacesLoadStateAtom } from '../../../atoms/workspaces';
import { CommandPalette } from './command-palette';

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: '/settings' },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useLocation: () => routerMocks.location,
  };
});

vi.mock('../../workspace/components/workspace-launch-modal', () => ({
  WorkspaceLaunchModal: () => null,
}));

function createWorkspace(id: string, path: string): Workspace {
  return {
    id,
    path,
    targetRuntime: 'native',
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

describe('CommandPalette', () => {
  beforeEach(() => {
    routerMocks.navigate.mockReset();
    routerMocks.location.pathname = '/settings';
  });

  it('switches workspaces by setting the active id in memory and navigating to /workspace', () => {
    const store = createStore();
    store.set(localeAtom, 'en');
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      'ws-1': createWorkspace('ws-1', '/tmp/one'),
      'ws-2': createWorkspace('ws-2', '/tmp/two'),
    });
    store.set(workspaceOrderAtom, ['ws-2', 'ws-1']);
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.click(screen.getByText('Workspace: two'));

    expect(store.get(activeWorkspaceIdAtom)).toBe('ws-2');
    expect(routerMocks.navigate).toHaveBeenCalledWith('/workspace');
  });
});
