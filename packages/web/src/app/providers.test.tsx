import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { supervisorsAtom, supervisorCyclesAtom } from '../features/supervisor/atoms';
import { routeEventToAtom } from './providers';

describe('routeEventToAtom', () => {
  it('removes supervisor state and cycles on delete events', () => {
    const store = createStore();
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
            objective: 'Track progress',
            evaluatorProviderId: 'claude',
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
              objective: 'Track progress',
              evaluatorProviderId: 'claude',
              createdAt: 1,
              completedAt: 2,
            },
          ],
        ],
      ])
    );

    routeEventToAtom(
      'workspace.ws-1.session.sess-1.supervisor.state',
      { supervisorId: 'sup-1', event: 'deleted' },
      store as any
    );

    expect(store.get(supervisorsAtom).size).toBe(0);
    expect(store.get(supervisorCyclesAtom).size).toBe(0);
  });
});
