/**
 * File System State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import type { FileNode } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

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
export const fileTreeStaleAtomFamily = atomFamily((workspaceId: string) => atom<boolean>(false));

/**
 * Loaded directories tracking (UI local state)
 * Tracks which directories have been expanded and loaded.
 * Written by: FileTreePanel when user expands a directory.
 */
export const loadedDirsAtomFamily = atomFamily((workspaceId: string) =>
  atom<Set<string>>(new Set())
);

/**
 * Expanded directories tracking (workspace-scoped UI state).
 * `null` means "not hydrated yet", otherwise the current expanded paths.
 */
export const expandedDirsAtomFamily = atomFamily((workspaceId: string) =>
  atom<Set<string> | null>(null)
);

/**
 * Open file atom family (UI local state).
 */
export interface OpenTextFile {
  kind: "text";
  path: string;
  content: string;
  savedContent: string;
  baseHash: string;
  isDirty: boolean;
  language?: string;
  viewingTextBackedImageAsText?: boolean;
  externalState?: "modified" | "deleted";
}

export interface OpenImageFile {
  kind: "image";
  path: string;
  mime: string;
  url: string;
  size: number;
  version: string;
  isTextBacked: boolean;
  externalState?: "modified" | "deleted";
}

export type OpenFile = OpenTextFile | OpenImageFile;

export type WorkspaceEditorMode = "preview" | "edit" | "diff";

const IMAGE_FILE_EXTENSION_PATTERN = /\.(avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

export function isPreviewByDefaultPath(path: string): boolean {
  return IMAGE_FILE_EXTENSION_PATTERN.test(path);
}

export function deriveEditorModeForOpenFile(file: OpenFile): WorkspaceEditorMode {
  if (file.kind === "image") {
    return "preview";
  }

  if (file.viewingTextBackedImageAsText) {
    return "edit";
  }

  return "edit";
}

export function deriveEditorModeForPath(path: string): WorkspaceEditorMode {
  return isPreviewByDefaultPath(path) ? "preview" : "edit";
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

export const editorModeAtomFamily = atomFamily((workspaceId: string) =>
  atom<WorkspaceEditorMode>("edit")
);

/**
 * Incremented when external workspace activity means open editor buffers
 * may need to reconcile with disk state.
 */
export const editorRefreshTokenAtomFamily = atomFamily((workspaceId: string) => atom<number>(0));

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
