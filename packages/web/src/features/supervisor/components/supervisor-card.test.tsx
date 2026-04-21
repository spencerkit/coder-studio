import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { SupervisorCard } from './supervisor-card';
import { supervisorsAtom, supervisorCyclesAtom } from '../atoms';
import { wsClientAtom } from '../../../atoms/connection';

describe('SupervisorCard', () => {
  it('shows the latest cycle history and trigger action', () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as any);
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
            evaluatorProviderId: 'codex',
            cycles: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          'sup-1',
          [
            {
              id: 'cycle-1',
              supervisorId: 'sup-1',
              sessionId: 'sess-1',
              status: 'completed',
              trigger: 'manual',
              evidenceSource: 'transcript',
              objective: 'Finish the server refactor',
              evaluatorProviderId: 'codex',
              progress: 65,
              result: 'Persistence and hydration are done.',
              createdAt: 1,
              completedAt: 2,
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText('Persistence and hydration are done.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '触发评估' }));
    expect(sendCommand).toHaveBeenCalledWith('supervisor.trigger', { id: 'sup-1' });
  });
});
