import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ObjectiveDialog } from './objective-dialog';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';
import { wsClientAtom } from '../../../atoms/connection';

describe('ObjectiveDialog', () => {
  it('submits evaluatorProviderId during enable', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as any);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: 'sess-1',
      mode: 'enable',
      draftObjective: 'Finish the server refactor',
      draftEvaluatorProviderId: 'codex',
    });
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText('Evaluator Provider'), {
      target: { value: 'claude' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启用' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('supervisor.create', {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        objective: 'Finish the server refactor',
        evaluatorProviderId: 'claude',
      });
    });
  });

  it('renders disable confirmation mode', () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as any);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: 'sess-1',
      mode: 'disable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
    store.set(
      supervisorsAtom,
      new Map([
        [
          'sess-1',
          {
            id: 'sup-1',
            sessionId: 'sess-1',
            workspaceId: 'ws-1',
            state: 'idle',
            objective: 'Finish the server refactor',
            evaluatorProviderId: 'claude',
            cycles: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText('禁用会停止评估并清空历史')).toBeInTheDocument();
    expect(screen.getByText('Finish the server refactor')).toBeInTheDocument();
  });
});
