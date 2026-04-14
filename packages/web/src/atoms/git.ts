/**
 * Git State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { GitStatus } from '@coder-studio/core';

/**
 * Git state by workspace (server state projection)
 * Written by: WS event handler for workspace.*.git.state
 */
export const gitStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<GitStatus | null>(null)
);

/**
 * Has changes (derived)
 */
export const hasGitChangesAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const status = get(gitStateAtomFamily(workspaceId));
    if (!status) return false;
    return (
      status.staged.length > 0 ||
      status.modified.length > 0 ||
      status.untracked.length > 0 ||
      status.deleted.length > 0
    );
  })
);

/**
 * Change count summary (derived)
 */
export const gitChangeCountAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const status = get(gitStateAtomFamily(workspaceId));
    if (!status) return { staged: 0, unstaged: 0, untracked: 0, total: 0 };
    return {
      staged: status.staged.length,
      unstaged: status.modified.length + status.deleted.length,
      untracked: status.untracked.length,
      total:
        status.staged.length +
        status.modified.length +
        status.untracked.length +
        status.deleted.length,
    };
  })
);