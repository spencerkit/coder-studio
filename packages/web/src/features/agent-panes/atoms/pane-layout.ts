/**
 * Agent Pane Layout State
 *
 * Server-backed pane layout projection owned by the agent-panes feature.
 */

import type {
  WorkspacePaneLeafKind,
  WorkspacePaneNode,
  WorkspacePaneSplit,
} from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

/**
 * Pane layout by workspace (agent pane splits).
 * The server owns pane structure; only the legacy migration path reads the
 * historical localStorage key.
 */
export interface PaneLeaf {
  id: string;
  type: "leaf";
  leafKind?: WorkspacePaneLeafKind;
  sessionId?: string;
}

export interface PaneSplit {
  id: string;
  type: "split";
  direction?: "horizontal" | "vertical";
  ratio?: number;
  children?: PaneNode[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export const LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX = "ui.paneLayout.";
export const PANE_RATIO_STORAGE_KEY_PREFIX = "ui.paneRatio.";

export const defaultPaneLayout: PaneNode = {
  id: "root",
  type: "leaf",
  leafKind: "draft",
};

export const paneLayoutAtomFamily = atomFamily((_workspaceId: string) =>
  atom<PaneNode>(defaultPaneLayout)
);

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLegacyPaneLayout(workspaceId: string): PaneNode | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(`${LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX}${workspaceId}`);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as PaneNode;
  } catch {
    return null;
  }
}

export function normalizePaneLayout(
  layout: WorkspacePaneNode | PaneNode | null | undefined
): PaneNode | null {
  return normalizePaneLayoutNode(layout);
}

export function toWorkspacePaneLayout(layout: WorkspacePaneNode | PaneNode): WorkspacePaneNode {
  if (layout.type === "leaf") {
    const leafKind = "leafKind" in layout ? layout.leafKind : undefined;
    const sessionId =
      "sessionId" in layout && typeof layout.sessionId === "string" ? layout.sessionId : undefined;

    if ((leafKind === "session" || !leafKind) && sessionId) {
      return {
        id: layout.id,
        type: "leaf",
        leafKind: "session",
        sessionId,
      };
    }

    if (leafKind === "editor") {
      return {
        id: layout.id,
        type: "leaf",
        leafKind: "editor",
      };
    }

    return {
      id: layout.id,
      type: "leaf",
      leafKind: "draft",
    };
  }

  const next: WorkspacePaneSplit = {
    id: layout.id,
    type: "split",
  };

  if (layout.direction) {
    next.direction = layout.direction;
  }

  if (layout.children) {
    next.children = layout.children.map((child) => toWorkspacePaneLayout(child));
  }

  return next;
}

function normalizePaneLayoutNode(
  layout: WorkspacePaneNode | PaneNode | null | undefined
): PaneNode | null {
  if (!layout) {
    return null;
  }

  if (layout.type === "leaf") {
    if ("leafKind" in layout && layout.leafKind) {
      if (layout.leafKind === "session" && layout.sessionId) {
        return {
          id: layout.id,
          type: "leaf",
          leafKind: "session",
          sessionId: layout.sessionId,
        };
      }

      return {
        id: layout.id,
        type: "leaf",
        leafKind: layout.leafKind === "editor" ? "editor" : "draft",
      };
    }

    return layout.sessionId
      ? {
          id: layout.id,
          type: "leaf",
          leafKind: "session",
          sessionId: layout.sessionId,
        }
      : {
          id: layout.id,
          type: "leaf",
          leafKind: "draft",
        };
  }

  return {
    id: layout.id,
    type: "split",
    direction: layout.direction,
    ratio: "ratio" in layout ? layout.ratio : undefined,
    children: layout.children?.map((child) => normalizePaneLayoutNode(child) ?? defaultPaneLayout),
  };
}

export function clearLegacyPaneLayout(workspaceId: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(`${LEGACY_PANE_LAYOUT_STORAGE_KEY_PREFIX}${workspaceId}`);
  } catch {
    // Ignore blocked or unavailable storage during legacy cleanup.
  }
}

export function readPaneRatio(workspaceId: string, splitId: string): number | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(`${PANE_RATIO_STORAGE_KEY_PREFIX}${workspaceId}.${splitId}`);
    if (raw === null) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePaneRatio(workspaceId: string, splitId: string, ratio: number): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(`${PANE_RATIO_STORAGE_KEY_PREFIX}${workspaceId}.${splitId}`, String(ratio));
  } catch {
    // Ignore blocked or quota-limited storage and keep the in-memory ratio.
  }
}
