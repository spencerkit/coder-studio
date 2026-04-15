/**
 * Supervisor atoms (Phase 3)
 */

import { atom } from 'jotai';
import type { Supervisor, SupervisorCycle } from '@coder-studio/core';

// Supervisor by session ID
export const supervisorsAtom = atom<Map<string, Supervisor>>(new Map());

// Supervisor cycles by supervisor ID
export const supervisorCyclesAtom = atom<Map<string, SupervisorCycle[]>>(new Map());

// Active supervisor objective dialog
export const supervisorDialogAtom = atom<{
  open: boolean;
  sessionId: string | null;
  mode: 'enable' | 'edit';
}>({
  open: false,
  sessionId: null,
  mode: 'enable',
});

// Derived atom for getting supervisor by session
export const supervisorBySessionAtom = atom(
  (get) => (sessionId: string) => {
    const supervisors = get(supervisorsAtom);
    return supervisors.get(sessionId);
  }
);
