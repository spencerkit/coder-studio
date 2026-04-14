/**
 * Workspace State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Workspace } from '@coder-studio/core';

/**
 * All workspaces (server state projection)
 * Written by: WS event handler for workspace.*.meta
 */
export const workspacesAtom = atom<Record<string, Workspace>>({});

/**
 * Single workspace by ID (derived atom)
 */
export const workspaceByIdAtomFamily = atomFamily((id: string) =>
  atom((get) => get(workspacesAtom)[id])
);

/**
 * Active workspace (derived)
 * Note: activeWorkspaceIdAtom is defined in ui.ts with localStorage persistence
 */
export const activeWorkspaceAtom = atom((get) => {
  // Import activeWorkspaceIdAtom from ui.ts
  const { activeWorkspaceIdAtom } = require('./ui');
  const wsId = get(activeWorkspaceIdAtom);
  if (!wsId) return null;
  return get(workspaceByIdAtomFamily(wsId));
});