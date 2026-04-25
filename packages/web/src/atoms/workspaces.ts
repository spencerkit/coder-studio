/**
 * Workspace State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { Workspace } from '@coder-studio/core';
import { activeWorkspaceIdAtom } from './ui';

export type WorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * All workspaces (server state projection)
 * Written by: WS event handler for workspace.*.meta
 */
export const workspacesAtom = atom<Record<string, Workspace>>({});

/**
 * Workspace ordering as discovered from server events.
 * Existing entries retain their relative position.
 */
export const workspaceOrderAtom = atom<string[]>([]);

/**
 * Workspace collection load state.
 */
export const workspacesLoadStateAtom = atom<WorkspaceLoadState>('idle');

/**
 * Last workspace load error, if any.
 */
export const workspacesLoadErrorAtom = atom<string | null>(null);

/**
 * Single workspace by ID (derived atom)
 */
export const workspaceByIdAtomFamily = atomFamily((id: string) =>
  atom((get) => get(workspacesAtom)[id])
);

/**
 * Ordered workspace ids preserving explicit order and appending unseen ids.
 */
export const orderedWorkspaceIdsAtom = atom((get) => {
  const orderedIds = get(workspaceOrderAtom);
  const workspaces = get(workspacesAtom);
  const existingIds = new Set(Object.keys(workspaces));

  const preservedIds = orderedIds.filter((id) => existingIds.has(id));
  const seenIds = new Set(preservedIds);
  const appendedIds = Object.keys(workspaces).filter((id) => !seenIds.has(id));

  return [...preservedIds, ...appendedIds];
});

/**
 * Ordered workspace collection.
 */
export const orderedWorkspacesAtom = atom((get) =>
  get(orderedWorkspaceIdsAtom)
    .map((id) => get(workspaceByIdAtomFamily(id)))
    .filter((workspace): workspace is Workspace => Boolean(workspace))
);

/**
 * Resolved active workspace id gated on load readiness.
 */
export const resolvedActiveWorkspaceIdAtom = atom((get) => {
  if (get(workspacesLoadStateAtom) !== 'ready') {
    return null;
  }

  const requestedId = get(activeWorkspaceIdAtom);
  const workspaces = get(workspacesAtom);
  if (requestedId && workspaces[requestedId]) {
    return requestedId;
  }

  return get(orderedWorkspaceIdsAtom)[0] ?? null;
});

/**
 * Active workspace (derived)
 */
export const activeWorkspaceAtom = atom((get) => {
  const wsId = get(resolvedActiveWorkspaceIdAtom);
  if (!wsId) return null;
  return get(workspaceByIdAtomFamily(wsId));
});
