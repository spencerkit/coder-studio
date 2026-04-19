/**
 * Session State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { Session, SessionState } from '@coder-studio/core';

/**
 * All sessions (server state projection)
 * Written by: WS event handler for session.*.state
 */
export const sessionsAtom = atom<Record<string, Session>>({});

/**
 * Sessions filtered by workspace (derived atom)
 */
export const sessionsByWorkspaceAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const all = get(sessionsAtom);
    return Object.values(all).filter((s) => s.workspaceId === workspaceId);
  })
);

/**
 * Single session by ID (derived atom)
 */
export const sessionByIdAtomFamily = atomFamily((id: string) =>
  atom((get) => get(sessionsAtom)[id])
);

/**
 * Active session in active workspace (derived)
 * Note: activeWorkspaceIdAtom is defined in ui.ts but accessed through a getter
 * to avoid circular dependency issues
 */
let _getActiveWorkspaceId: (() => string | null) | null = null;

export function setActiveWorkspaceIdGetter(getter: () => string | null): void {
  _getActiveWorkspaceId = getter;
}

export const activeSessionAtom = atom((get) => {
  // activeWorkspaceIdAtom is defined in ui.ts
  // We use a deferred import to avoid circular dependencies
  const wsId = _getActiveWorkspaceId?.() ?? null;
  if (!wsId) return null;
  const sessions = get(sessionsByWorkspaceAtomFamily(wsId));
  return sessions.find((s) => s.state === 'running' || s.state === 'idle') ?? null;
});

/**
 * Session count by state (derived, for statistics)
 */
export const sessionCountByStateAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const sessions = get(sessionsByWorkspaceAtomFamily(workspaceId));
    const counts: Record<SessionState, number> = {
      draft: 0,
      starting: 0,
      running: 0,
      idle: 0,
      interrupted: 0,
      unavailable: 0,
      ended: 0,
    };
    for (const s of sessions) {
      counts[s.state]++;
    }
    return counts;
  })
);
