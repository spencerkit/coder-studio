/**
 * Session State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import type { Session, SessionState } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { activeWorkspaceIdAtom } from "./workspaces";

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
 */
export function setActiveWorkspaceIdGetter(_getter: () => string | null): void {
  // Deprecated compatibility hook retained during atom migration.
}

export const activeSessionAtom = atom((get) => {
  const wsId = get(activeWorkspaceIdAtom);
  if (!wsId) return null;
  const sessions = get(sessionsByWorkspaceAtomFamily(wsId));
  return sessions.find((s) => s.state === "running" || s.state === "idle") ?? null;
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
      ended: 0,
    };
    for (const s of sessions) {
      counts[s.state]++;
    }
    return counts;
  })
);
