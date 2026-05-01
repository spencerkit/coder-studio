import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { BranchPickerButton } from './branch-picker-button';
import { branchQuickPickAtom, gitBranchListAtomFamily } from '../../atoms';

describe('BranchPickerButton', () => {
  it('displays current branch name', () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily('test-workspace'), {
      current: 'main',
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('shows "No branch" when detached HEAD', () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily('test-workspace'), {
      current: '',
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText('No branch')).toBeInTheDocument();
  });

  it('opens Quick Pick when clicked', () => {
    const store = createStore();
    store.set(gitBranchListAtomFamily('test-workspace'), {
      current: 'main',
      branches: [],
      loading: false,
    });

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(store.get(branchQuickPickAtom)).toEqual({
      visible: true,
      workspaceId: 'test-workspace',
      inputValue: '',
    });
  });
});
