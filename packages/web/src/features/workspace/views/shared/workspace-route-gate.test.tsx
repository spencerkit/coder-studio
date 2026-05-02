import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { localeAtom } from '../../../../atoms/app-ui';
import { activeWorkspaceIdAtom } from '../../../../atoms/workspaces';
import {
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../../../atoms/workspaces';
import { WorkspaceRouteGate } from './workspace-route-gate';

describe('WorkspaceRouteGate', () => {
  it('shows a loading shell while workspaces are unresolved', () => {
    const store = createStore();
    store.set(localeAtom, 'en');
    store.set(workspacesLoadStateAtom, 'loading');

    render(
      <Provider store={store}>
        <WorkspaceRouteGate>
          <div>ready</div>
        </WorkspaceRouteGate>
      </Provider>
    );

    expect(screen.getByText('Loading workspaces')).toBeInTheDocument();
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
  });

  it('shows an error shell when workspace bootstrap fails', () => {
    const store = createStore();
    store.set(localeAtom, 'en');
    store.set(workspacesLoadStateAtom, 'error');
    store.set(workspacesLoadErrorAtom, 'Failed to fetch workspace list');

    render(
      <Provider store={store}>
        <WorkspaceRouteGate>
          <div>ready</div>
        </WorkspaceRouteGate>
      </Provider>
    );

    expect(screen.getByText('Failed to load workspaces')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch workspace list')).toBeInTheDocument();
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
  });

  it('renders children when an active workspace is available', () => {
    const store = createStore();
    store.set(workspacesAtom, {
      'ws-1': {
        id: 'ws-1',
        path: '/tmp/ws-1',
        targetRuntime: 'native',
        openedAt: 1,
        lastActiveAt: 1,
      },
    });
    store.set(workspaceOrderAtom, ['ws-1']);
    store.set(activeWorkspaceIdAtom, 'ws-1');
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <WorkspaceRouteGate>
          <div>ready</div>
        </WorkspaceRouteGate>
      </Provider>
    );

    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('renders children when the workspace list is ready but empty', () => {
    const store = createStore();
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'ready');

    render(
      <Provider store={store}>
        <WorkspaceRouteGate>
          <div>ready</div>
        </WorkspaceRouteGate>
      </Provider>
    );

    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.queryByText('Loading workspaces')).not.toBeInTheDocument();
  });
});
