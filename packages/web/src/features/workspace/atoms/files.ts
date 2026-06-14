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
export const fileTreeAtomFamily = atomFamily((_workspaceId: string) =>
  atom<Map<string, FileNode[]> | null>(null)
);

/**
 * File tree stale flag (used to trigger refresh)
 * Written by: WS event handler for workspace.*.fs.dirty
 */
export const fileTreeStaleAtomFamily = atomFamily((_workspaceId: string) => atom<boolean>(false));

/**
 * Loaded directories tracking (UI local state)
 * Tracks which directories have been expanded and loaded.
 * Written by: FileTreePanel when user expands a directory.
 */
export const loadedDirsAtomFamily = atomFamily((_workspaceId: string) =>
  atom<Set<string>>(new Set<string>())
);

/**
 * Expanded directories tracking (workspace-scoped UI state).
 * `null` means "not hydrated yet", otherwise the current expanded paths.
 */
export const expandedDirsAtomFamily = atomFamily((_workspaceId: string) =>
  atom<Set<string> | null>(null)
);

/**
 * Open file atom family (UI local state).
 */
export interface OpenTextFile {
  kind: "text";
  path: string;
  displayPath?: string;
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
  displayPath?: string;
  mime: string;
  url: string;
  size: number;
  version: string;
  isTextBacked: boolean;
  externalState?: "modified" | "deleted";
}

export type OpenFile = OpenTextFile | OpenImageFile;

export type WorkspaceEditorMode = "preview" | "edit" | "diff";

export interface WorkspaceFileEditorTab {
  kind: "file";
  path: string;
}

export type DevBrowserDevicePreset = "desktop" | "iphone-14" | "pixel-7" | "custom";
export type DevBrowserOrientation = "portrait" | "landscape";
export type DevBrowserUserAgentMode = "desktop" | "mobile";

export interface WorkspaceBrowserEditorTab {
  kind: "browser";
  id: string;
  url: string | null;
  devicePreset: DevBrowserDevicePreset;
  viewportWidth: number | null;
  viewportHeight: number | null;
  orientation: DevBrowserOrientation;
  userAgentMode: DevBrowserUserAgentMode;
}

export type WorkspaceEditorTab = WorkspaceFileEditorTab | WorkspaceBrowserEditorTab;

let browserTabIdCounter = 0;

export const MAX_BROWSER_VIEWPORT_DIMENSION = 4096;

function normalizeViewportDimension(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_BROWSER_VIEWPORT_DIMENSION
    ? value
    : null;
}

function normalizeBrowserOrientation(value: unknown): DevBrowserOrientation {
  return value === "portrait" || value === "landscape" ? value : "portrait";
}

function normalizeBrowserUserAgentMode(value: unknown): DevBrowserUserAgentMode {
  return value === "mobile" || value === "desktop" ? value : "desktop";
}

function normalizeBrowserDevicePreset(value: unknown): DevBrowserDevicePreset {
  return value === "iphone-14" || value === "pixel-7" || value === "custom" || value === "desktop"
    ? value
    : "desktop";
}

export function createWorkspaceBrowserEditorTab(
  url: string | null = null
): WorkspaceBrowserEditorTab {
  const normalizedUrl = typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
  const generatedId =
    globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}-${++browserTabIdCounter}`;

  return {
    kind: "browser",
    id: generatedId,
    url: normalizedUrl,
    devicePreset: "desktop",
    viewportWidth: null,
    viewportHeight: null,
    orientation: "portrait",
    userAgentMode: "desktop",
  };
}

const IMAGE_FILE_EXTENSION_PATTERN = /\.(avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const DOCUMENT_PREVIEW_EXTENSION_PATTERN = /\.(md|markdown|html?)$/i;

export function isDocumentPreviewPath(path: string): boolean {
  return DOCUMENT_PREVIEW_EXTENSION_PATTERN.test(path);
}

export function deriveDocumentPreviewKind(path: string): "markdown" | "html" | null {
  if (/\.(md|markdown)$/i.test(path)) {
    return "markdown";
  }

  if (/\.html?$/i.test(path)) {
    return "html";
  }

  return null;
}

export function isPreviewByDefaultPath(path: string): boolean {
  return IMAGE_FILE_EXTENSION_PATTERN.test(path) || isDocumentPreviewPath(path);
}

export function deriveEditorModeForOpenFile(file: OpenFile): WorkspaceEditorMode {
  if (file.kind === "image") {
    return "preview";
  }

  if (isDocumentPreviewPath(file.path)) {
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

function normalizeBrowserTab(entry: unknown): WorkspaceBrowserEditorTab | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Partial<WorkspaceBrowserEditorTab>;
  if (candidate.kind !== "browser") {
    return null;
  }

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return null;
  }

  return {
    kind: "browser",
    id: candidate.id.trim(),
    url:
      typeof candidate.url === "string" && candidate.url.trim().length > 0
        ? candidate.url.trim()
        : null,
    devicePreset: normalizeBrowserDevicePreset(candidate.devicePreset),
    viewportWidth: normalizeViewportDimension(candidate.viewportWidth),
    viewportHeight: normalizeViewportDimension(candidate.viewportHeight),
    orientation: normalizeBrowserOrientation(candidate.orientation),
    userAgentMode: normalizeBrowserUserAgentMode(candidate.userAgentMode),
  };
}

export function normalizeWorkspaceEditorTabs(value: unknown): WorkspaceEditorTab[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenFilePaths = new Set<string>();
  const seenBrowserIds = new Set<string>();
  const next: WorkspaceEditorTab[] = [];

  for (const entry of value) {
    const normalizedBrowserTab = normalizeBrowserTab(entry);
    if (normalizedBrowserTab) {
      if (seenBrowserIds.has(normalizedBrowserTab.id)) {
        continue;
      }

      seenBrowserIds.add(normalizedBrowserTab.id);
      next.push(normalizedBrowserTab);
      continue;
    }

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Partial<WorkspaceFileEditorTab>;
    if (candidate.kind !== "file") {
      continue;
    }

    if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
      continue;
    }

    const path = candidate.path.trim();
    if (seenFilePaths.has(path)) {
      continue;
    }

    seenFilePaths.add(path);
    next.push({ kind: "file", path });
  }

  return next;
}

export const openFilesAtomFamily = atomFamily((_workspaceId: string) =>
  atom<Record<string, OpenFile>>({})
);

export const openEditorTabsAtomFamily = atomFamily((_workspaceId: string) =>
  atom<WorkspaceEditorTab[]>([])
);

export const activeEditorTabAtomFamily = atomFamily((_workspaceId: string) =>
  atom<WorkspaceEditorTab | null>(null)
);

/**
 * Persisted open editor path list. File buffers still live in openFilesAtomFamily.
 */
export const openEditorPathsAtomFamily = atomFamily((_workspaceId: string) => atom<string[]>([]));

/**
 * Whether the global editor surface is open. This is intentionally separate
 * from activeFilePath so an editor can stay open after its final tab closes.
 */
export const editorViewVisibleAtomFamily = atomFamily((_workspaceId: string) =>
  atom<boolean>(false)
);

/**
 * Active file path (UI local state)
 */
export const activeFilePathAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string | null>(null)
);

export const editorModeAtomFamily = atomFamily((_workspaceId: string) =>
  atom<WorkspaceEditorMode>("preview")
);

/**
 * Incremented when external workspace activity means open editor buffers
 * may need to reconcile with disk state.
 */
export const editorRefreshTokenAtomFamily = atomFamily((_workspaceId: string) => atom<number>(0));

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
    return Object.values(files).filter((file) => file.kind === "text" && file.isDirty).length;
  })
);
