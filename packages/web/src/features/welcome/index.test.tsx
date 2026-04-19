import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WelcomePage } from './index';

vi.mock('../workspace/components/workspace-launch-modal', () => ({
  WorkspaceLaunchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workspace-launch-modal">
      <button type="button" onClick={onClose}>
        Close modal
      </button>
    </div>
  ),
}));

describe('WelcomePage', () => {
  it('opens the workspace launch modal directly from the primary action', () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }));

    expect(screen.getByTestId('workspace-launch-modal')).toBeInTheDocument();
  });

  it('navigates to settings from the secondary action', () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/settings" element={<div>Settings Screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(screen.getByText('Settings Screen')).toBeInTheDocument();
  });
});
