import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WelcomePage } from './index';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

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
  beforeEach(() => {
    viewportMocks.viewport = 'desktop';
  });

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

  it('adds the mobile welcome page variant classes on mobile viewports', () => {
    viewportMocks.viewport = 'mobile';
    const store = createStore();

    render(
      <Provider store={store}>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </Provider>
    );

    expect(document.querySelector('.welcome-container--mobile')).toBeTruthy();
    expect(document.querySelector('.welcome-card--mobile')).toBeTruthy();
  });
});
