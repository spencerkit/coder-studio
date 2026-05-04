import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { activeWorkspaceIdAtom } from '../atoms/workspaces';
import {
  activeWorkspaceAtom,
  workspaceOrderAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../atoms/workspaces';
import { fileTreeStaleAtomFamily } from '../features/workspace/atoms';
import { sessionsAtom } from '../atoms';
import { SESSION_OUTPUT_TAIL_BYTES, sessionOutputTailAtom } from '../features/notifications/atoms';
import { terminalMetaAtomFamily } from '../features/terminal-panel/atoms';
import { supervisorsAtom, supervisorCyclesAtom } from '../features/supervisor/atoms';
import { resetAppProvidersSingletonsForTests, routeEventToAtom } from './providers';

describe('routeEventToAtom', () => {
  beforeEach(() => {
    resetAppProvidersSingletonsForTests();
  });

  afterEach(() => {
    resetAppProvidersSingletonsForTests();
  });

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

  it('marks the file tree stale when an fs.dirty event arrives', () => {
    const store = createStore();

    routeEventToAtom('workspace.ws-1.fs.dirty', { reason: 'fs_change' }, store as any);

    expect(store.get(fileTreeStaleAtomFamily('ws-1'))).toBe(true);
  });

  it('ignores git metadata-only fs.dirty events for the file tree stale flag', () => {
    const store = createStore();

    routeEventToAtom('workspace.ws-1.fs.dirty', { reason: 'git_metadata' }, store as any);

    expect(store.get(fileTreeStaleAtomFamily('ws-1'))).toBe(false);
  });

  it('appends cleaned terminal output text to the matching session tail buffer', () => {
    const store = createStore();
    store.set(sessionsAtom, {
      'sess-1': {
        id: 'sess-1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 7,
        size: 11,
        bytes: new TextEncoder().encode('[32mhello[0m\n'),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({
      'sess-1': 'hello\n',
    });
  });

  it('strips ANSI sequences split across multiple terminal output events', () => {
    const store = createStore();
    store.set(sessionsAtom, {
      'sess-1': {
        id: 'sess-1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 7,
        size: 4,
        bytes: new TextEncoder().encode('\x1b[32'),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({});

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 8,
        size: 11,
        bytes: new TextEncoder().encode('mhello\x1b[0m\n'),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({
      'sess-1': 'hello\n',
    });
  });

  it('preserves multibyte utf-8 characters split across terminal output events', () => {
    const store = createStore();
    store.set(sessionsAtom, {
      'sess-1': {
        id: 'sess-1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 7,
        size: 2,
        bytes: new Uint8Array([0x41, 0xe2]),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({
      'sess-1': 'A',
    });

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 8,
        size: 3,
        bytes: new Uint8Array([0x9c, 0x93, 0x42]),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({
      'sess-1': 'A✓B',
    });
  });

  it('does not leak ANSI fragments when the cleaned tail buffer trims from the head at the size cap', () => {
    const store = createStore();
    store.set(sessionsAtom, {
      'sess-1': {
        id: 'sess-1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'running',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
      },
    });

    store.set(sessionOutputTailAtom, {
      'sess-1': 'x'.repeat(SESSION_OUTPUT_TAIL_BYTES - 2),
    });

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 7,
        size: 4,
        bytes: new TextEncoder().encode('\x1b[32'),
      },
      store as any
    );

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 8,
        size: 6,
        bytes: new TextEncoder().encode('mOK\n'),
      },
      store as any
    );

    const tail = store.get(sessionOutputTailAtom)['sess-1'];
    expect(tail).toBe('x'.repeat(SESSION_OUTPUT_TAIL_BYTES - 3) + 'OK\n');
    expect(tail.startsWith('[32m')).toBe(false);
  });

  it('ignores terminal output bytes when no matching session exists', () => {
    const store = createStore();

    routeEventToAtom(
      'workspace.ws-1.terminal.term-1.output',
      {
        transport: 'binary',
        streamId: 7,
        size: 5,
        bytes: new TextEncoder().encode('hello'),
      },
      store as any
    );

    expect(store.get(sessionOutputTailAtom)).toEqual({});
  });

  it('removes local session artifacts on session removed lifecycle events', () => {
    const store = createStore();
    store.set(sessionsAtom, {
      'sess-1': {
        id: 'sess-1',
        workspaceId: 'ws-1',
        terminalId: 'term-1',
        providerId: 'claude',
        state: 'ended',
        capability: 'full',
        startedAt: 1,
        lastActiveAt: 1,
        endedAt: 2,
      },
    });
    store.set(terminalMetaAtomFamily('term-1'), {
      id: 'term-1',
      workspaceId: 'ws-1',
      kind: 'agent',
      alive: false,
      exitCode: 1,
      title: 'Claude',
    });
    store.set(sessionOutputTailAtom, {
      'sess-1': 'tail output',
    });

    routeEventToAtom(
      'workspace.ws-1.session.sess-1.lifecycle',
      { event: 'removed' },
      store as any
    );

    expect(store.get(sessionsAtom)).toEqual({});
    expect(store.get(terminalMetaAtomFamily('term-1'))).toBeNull();
    expect(store.get(sessionOutputTailAtom)).toEqual({});
  });
});
