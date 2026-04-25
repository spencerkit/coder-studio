import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { activeWorkspaceIdAtom } from '../atoms/ui';
import {
  activeWorkspaceAtom,
  workspaceOrderAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../atoms/workspaces';
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

  it('appends brand-new workspace meta events to workspace order without reordering existing entries', () => {
    const store = createStore();

    routeEventToAtom(
      'workspace.ws-1.meta',
      { path: '/tmp/ws-1', targetRuntime: 'native' },
      store as any
    );
    routeEventToAtom(
      'workspace.ws-2.meta',
      { path: '/tmp/ws-2', targetRuntime: 'native' },
      store as any
    );

    expect(store.get(workspaceOrderAtom)).toEqual(['ws-1', 'ws-2']);

    routeEventToAtom(
      'workspace.ws-1.meta',
      { name: 'Renamed workspace' },
      store as any
    );
    routeEventToAtom(
      'workspace.ws-2.meta',
      { name: 'Also renamed' },
      store as any
    );

    expect(store.get(workspaceOrderAtom)).toEqual(['ws-1', 'ws-2']);
  });

  it('marks workspace load state ready and clears the load error for a valid brand-new workspace meta event', () => {
    const store = createStore();
    store.set(workspacesLoadStateAtom, 'loading');
    store.set(workspacesLoadErrorAtom, 'load failed');

    routeEventToAtom(
      'workspace.ws-1.meta',
      { path: '/tmp/ws-1', targetRuntime: 'native' },
      store as any
    );

    expect(store.get(workspacesLoadStateAtom)).toBe('ready');
    expect(store.get(workspacesLoadErrorAtom)).toBeNull();
  });

  it('resolves the active workspace after a valid brand-new workspace meta event when the intent points at that id', () => {
    const store = createStore();
    store.set(activeWorkspaceIdAtom, 'ws-1');

    routeEventToAtom(
      'workspace.ws-1.meta',
      { path: '/tmp/ws-1', targetRuntime: 'native' },
      store as any
    );

    expect(store.get(activeWorkspaceAtom)?.id).toBe('ws-1');
  });

  it('does not append a pathless meta patch for a brand-new workspace', () => {
    const store = createStore();

    routeEventToAtom(
      'workspace.ws-ghost.meta',
      { name: 'Ghost workspace' },
      store as any
    );

    expect(store.get(workspaceOrderAtom)).toEqual([]);
  });
});
