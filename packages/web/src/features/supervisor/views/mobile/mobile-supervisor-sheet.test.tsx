import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import userEvent from '@testing-library/user-event';
import { localeAtom } from '../../../../atoms/app-ui';
import { wsClientAtom } from '../../../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../../atoms';
import { MobileSupervisorSheet } from './mobile-supervisor-sheet';

describe('MobileSupervisorSheet', () => {
  it('opens the enable flow inside the same sheet without rendering a second overlay', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ id: 'sup-1' });
    const store = createStore();
    window.localStorage.setItem('ui.locale', JSON.stringify('en'));
    store.set(localeAtom, 'en');
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet
          sessionId="sess-1"
          workspaceId="ws-1"
          onClose={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByText('Supervisor is not enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enable Objective' }));

    expect(screen.getByLabelText('Objective')).toBeInTheDocument();
    expect(document.querySelectorAll('.mobile-sheet-layer')).toHaveLength(1);
    expect(document.querySelector('.modal-overlay')).toBeNull();

    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Reduce mobile regression bugs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('supervisor.create', {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        objective: 'Reduce mobile regression bugs',
        evaluatorProviderId: 'claude',
      });
    });
  });

  it('returns from detail view to the supervisor root when tapping back', () => {
    const store = createStore();
    window.localStorage.setItem('ui.locale', JSON.stringify('en'));
    store.set(localeAtom, 'en');
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());
    store.set(supervisorDialogAtom, {
      open: false,
      sessionId: null,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });

    render(
      <Provider store={store}>
        <MobileSupervisorSheet
          sessionId="sess-1"
          workspaceId="ws-1"
          onClose={vi.fn()}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enable Objective' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Supervisor is not enabled')).toBeInTheDocument();
    expect(screen.queryByLabelText('Objective')).not.toBeInTheDocument();
  });

  it('opens the evaluator provider picker inside the mobile supervisor detail flow', async () => {
    const user = userEvent.setup();
    const store = createStore();

    window.localStorage.setItem('ui.locale', JSON.stringify('en'));
    store.set(localeAtom, 'en');
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet
          sessionId="sess-1"
          workspaceId="ws-1"
          onClose={vi.fn()}
        />
      </Provider>
    );

    await user.click(screen.getByRole('button', { name: 'Enable Objective' }));
    await user.click(screen.getByRole('button', { name: 'Evaluator' }));

    expect(screen.getByRole('region', { name: 'Evaluator sheet' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    expect(screen.getByRole('button', { name: 'Evaluator' })).toHaveTextContent('Codex');
  });
});
