/**
 * File System State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { FileNode } from '@coder-studio/core';

/**
 * File tree by workspace (server state projection)
 * Written by: WS event handler for workspace.*.fs.tree
 *
 * Stored as Map<parentPath, FileNode[]> where:
 *   - '.' maps to root-level children
 *   - 'src' maps to children of the src/ directory
 *   - 'src/lib' maps to children of src/lib/
 *
 * This avoids O(n) recursive traversal when inserting loaded children.
 */
export const fileTreeAtomFamily = atomFamily((workspaceId: string) =>
  atom<Map<string, FileNode[]> | null>(null)
);

/**
 * File tree stale flag (used to trigger refresh)
 * Written by: WS event handler for workspace.*.fs.dirty
 */
export const fileTreeStaleAtomFamily = atomFamily((workspaceId: string) =>
  atom<boolean>(false)
);

/**
 * Loaded directories tracking (UI local state)
 * Tracks which directories have been expanded and loaded.
 * Written by: FileTreePanel when user expands a directory.
 */
export const loadedDirsAtomFamily = atomFamily((workspaceId: string) =>
  atom<Set<string>>(new Set())
);

/**
 * Open file atom family (UI local state).
 *
 * Files come in two flavors so the editor can route each one correctly:
 *
 *   - `text`: backed by a Monaco buffer with dirty-tracking and save.
 *   - `image`: backed by a URL pointing at `/api/file`; rendered as an
 *     <img> tag. For SVG (`isTextBacked: true`) the editor also offers an
 *     "edit as text" toggle, which flips the same path to a text OpenFile.
 */
export interface OpenTextFile {
  kind: 'text';
  path: string;
  content: string;
  baseHash: string;
  isDirty: boolean;
  language?: string;
  /**
   * True if this file *could* be previewed as an image (SVG) but the user
   * explicitly asked to edit it as text. Used so the editor header can keep
   * showing the "preview as image" toggle.
   */
  viewingTextBackedImageAsText?: boolean;
}

export interface OpenImageFile {
  kind: 'image';
  path: string;
  mime: string;
  /** Relative URL suitable for direct use in <img src>. */
  url: string;
  size: number;
  /** True for SVG — the editor offers an "edit as text" toggle. */
  isTextBacked: boolean;
}

export type OpenFile = OpenTextFile | OpenImageFile;

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
