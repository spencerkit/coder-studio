import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { wsClientAtom } from '../../../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../../atoms';
import { MobileSupervisorSheet } from './mobile-supervisor-sheet';

describe('MobileSupervisorSheet', () => {
  it('opens the enable flow inside the same sheet without rendering a second overlay', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ id: 'sup-1' });
    const store = createStore();
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

    expect(screen.getByText('Supervisor 未启用')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '启用目标' }));

    expect(screen.getByLabelText('目标描述')).toBeInTheDocument();
    expect(document.querySelectorAll('.mobile-sheet-layer')).toHaveLength(1);
    expect(document.querySelector('.modal-overlay')).toBeNull();

    fireEvent.change(screen.getByLabelText('目标描述'), {
      target: { value: 'Reduce mobile regression bugs' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启用' }));

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

    fireEvent.click(screen.getByRole('button', { name: '启用目标' }));
    fireEvent.click(screen.getByRole('button', { name: '返回上一层' }));

    expect(screen.getByText('Supervisor 未启用')).toBeInTheDocument();
    expect(screen.queryByLabelText('目标描述')).not.toBeInTheDocument();
  });
});
