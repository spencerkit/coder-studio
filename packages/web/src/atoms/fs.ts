/**
 * File System State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { FileNode } from '@coder-studio/core';

/**
 * File tree by workspace (server state projection)
 * Written by: WS event handler for workspace.*.fs.tree
 */
export const fileTreeAtomFamily = atomFamily((workspaceId: string) =>
  atom<FileNode | null>(null)
);

/**
 * File tree stale flag (used to trigger refresh)
 * Written by: WS event handler for workspace.*.fs.dirty
 */
export const fileTreeStaleAtomFamily = atomFamily((workspaceId: string) =>
  atom<boolean>(false)
);

/**
 * Open file atom family (UI local state)
 * Each open file tracks: path, content, baseHash, isDirty
 */
export interface OpenFile {
  path: string;
  content: string;
  baseHash: string;
  isDirty: boolean;
  language?: string;
}

export const openFilesAtomFamily = atomFamily((workspaceId: string) =>
  atom<Record<string, OpenFile>>({})
);

/**
 * Active file path (UI local state)
 */
export const activeFilePathAtomFamily = atomFamily((workspaceId: string) =>
  atom<string | null>(null)
);

/**
 * Active file (derived)
 */
export const activeFileAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const path = get(activeFilePathAtomFamily(workspaceId));
    if (!path) return null;
    const files = get(openFilesAtomFamily(workspaceId));
    return files[path] ?? null;
  })
);

/**
 * Dirty files count (derived)
 */
export const dirtyFilesCountAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const files = get(openFilesAtomFamily(workspaceId));
    return Object.values(files).filter((f) => f.isDirty).length;
  })
);