import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Workspace } from '@coder-studio/core';
import { TopBar } from './index';
import { workspaceOrderAtom, workspacesAtom, workspacesLoadStateAtom } from '../../atoms/workspaces';

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

vi.mock('./components/connection-status', () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

vi.mock('../workspace/views/shared/workspace-launch-modal', () => ({
  WorkspaceLaunchModal: () => null,
}));

vi.mock('./components/tab', () => ({
  WorkspaceTab: ({
    workspace,
    isActive,
  }: {
    workspace: Workspace;
    isActive: boolean;
  }) => (
    <div data-testid="workspace-tab" data-active={String(isActive)}>
      {workspace.id}
    </div>
  ),
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

describe('TopBar', () => {
  beforeEach(() => {
    routerMocks.navigate.mockReset();
  });

  it('renders tabs in workspace order and highlights the resolved active workspace', () => {
    const store = createStore();
    store.set(workspacesAtom, {
      'ws-a': createWorkspace('ws-a', '/tmp/a'),
      'ws-b': createWorkspace('ws-b', '/tmp/b'),
    });
    store.set(workspaceOrderAtom, ['ws-b', 'ws-a']);
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <TopBar />
      </Provider>
    );

    const tabs = screen.getAllByTestId('workspace-tab');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['ws-b', 'ws-a']);
    expect(tabs[0]?.getAttribute('data-active')).toBe('true');
    expect(tabs[1]?.getAttribute('data-active')).toBe('false');
  });
});
