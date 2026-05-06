import type { PaneNode } from "./atoms/pane-layout";

type PaneDirection = NonNullable<PaneNode["direction"]>;

function createDraftLeaf(id: string): PaneNode {
  return {
    id,
    type: "leaf",
  };
}

function createSessionLeaf(id: string, sessionId: string): PaneNode {
  return {
    id,
    type: "leaf",
    sessionId,
  };
}

export function splitPaneByPaneId(
  node: PaneNode,
  paneId: string,
  direction: PaneDirection
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) {
      return node;
    }

    const splitId = `split-${node.id}-${direction}-${Date.now()}`;
    return {
      id: splitId,
      type: "split",
      direction,
      ratio: 0.5,
      children: [{ ...node }, createDraftLeaf(`${splitId}-draft`)],
    };
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = splitPaneByPaneId(child, paneId, direction);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return node;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function splitPaneBySessionId(
  node: PaneNode,
  sessionId: string,
  direction: PaneDirection
): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== sessionId) {
      return node;
    }

    const splitId = `split-${node.id}-${direction}-${Date.now()}`;
    return {
      id: splitId,
      type: "split",
      direction,
      ratio: 0.5,
      children: [{ ...node }, createDraftLeaf(`${splitId}-draft`)],
    };
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = splitPaneBySessionId(child, sessionId, direction);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return node;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function assignSessionToPane(node: PaneNode, paneId: string, sessionId: string): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) {
      return node;
    }

    return {
      ...node,
      sessionId,
    };
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = assignSessionToPane(child, paneId, sessionId);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return node;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function closePaneBySessionId(node: PaneNode, sessionId: string): PaneNode {
  // Handle draft pane closure: __draft__<paneId>
  if (sessionId.startsWith("__draft__")) {
    const paneId = sessionId.replace("__draft__", "");
    return closeDraftPaneById(node, paneId);
  }
  return replaceSessionWithDraft(node, sessionId);
}

/**
 * Close a draft pane (leaf with no sessionId) by paneId
 */
function closeDraftPane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") {
    if (node.id === paneId && !node.sessionId) {
      return null;
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren: PaneNode[] = [];
  for (const child of children) {
    const nextChild = closeDraftPane(child, paneId);
    if (nextChild !== child) {
      changed = true;
    }
    if (nextChild !== null) {
      nextChildren.push(nextChild);
    }
  }

  if (!changed) {
    return node;
  }

  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  if (nextChildren.length === 0) {
    return null;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function closeDraftPaneById(node: PaneNode, paneId: string): PaneNode {
  return closeDraftPane(node, paneId) ?? { id: node.id, type: "leaf" };
}

/**
 * Close a session pane by turning it into a draft leaf while preserving the
 * existing split structure. This matches the session-card close behavior:
 * the session ends, but the workspace layout remains stable so the user can
 * immediately launch a replacement session in the same pane.
 */
function replaceSessionWithDraft(node: PaneNode, sessionId: string): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId === sessionId) {
      return {
        id: node.id,
        type: "leaf",
      };
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = replaceSessionWithDraft(child, sessionId);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return node;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function paneLayoutHasSession(node: PaneNode, sessionIds: Set<string>): boolean {
  if (node.type === "leaf") {
    return node.sessionId ? sessionIds.has(node.sessionId) : false;
  }

  return node.children?.some((child) => paneLayoutHasSession(child, sessionIds)) ?? false;
}

export function paneLayoutReferencesMissingSession(
  node: PaneNode,
  sessionIds: Set<string>
): boolean {
  if (node.type === "leaf") {
    return node.sessionId ? !sessionIds.has(node.sessionId) : false;
  }

  return (
    node.children?.some((child) => paneLayoutReferencesMissingSession(child, sessionIds)) ?? false
  );
}

/**
 * Collect all session IDs referenced in a pane layout tree.
 */
export function collectSessionIds(node: PaneNode): string[] {
  if (node.type === "leaf") {
    return node.sessionId ? [node.sessionId] : [];
  }
  return node.children?.flatMap((child) => collectSessionIds(child)) ?? [];
}

export function appendSessionToLayout(
  node: PaneNode,
  sessionId: string,
  anchorSessionId?: string | null,
  direction: PaneDirection = "horizontal"
): PaneNode {
  const draftFilled = assignFirstDraftPane(node, sessionId);
  if (draftFilled) {
    return draftFilled;
  }

  if (anchorSessionId) {
    const anchoredSplit = splitLeafForNewSession(node, sessionId, direction, anchorSessionId);
    if (anchoredSplit) {
      return anchoredSplit;
    }
  }

  const fallbackSplit = splitLeafForNewSession(node, sessionId, direction);
  if (fallbackSplit) {
    return fallbackSplit;
  }

  if (node.type === "leaf" && !node.sessionId) {
    return {
      ...node,
      sessionId,
    };
  }

  return {
    id: "root",
    type: "leaf",
    sessionId,
  };
}

export function createFallbackPaneLayout(sessionIds: string[]): PaneNode {
  if (sessionIds.length === 0) {
    return { id: "root", type: "leaf" };
  }

  if (sessionIds.length === 1) {
    return { id: "fallback-leaf-1", type: "leaf", sessionId: sessionIds[0]! };
  }

  const [firstId, ...rest] = sessionIds;
  return {
    id: "split-fallback-1",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "fallback-leaf-1", type: "leaf", sessionId: firstId! },
      createFallbackPaneLayoutBranch(rest, 2),
    ],
  };
}

/**
 * Sanitize pane layout: replace references to ended/removed sessions with draft leaves.
 * Preserves the entire split structure so layout is maintained on page refresh.
 */
export function sanitizePaneLayout(node: PaneNode, liveSessionIds: Set<string>): PaneNode {
  if (node.type === "leaf") {
    // If this leaf references a session that is ended or removed, turn it into a draft
    if (node.sessionId && !liveSessionIds.has(node.sessionId)) {
      return { id: node.id, type: "leaf" };
    }
    return node;
  }

  // For splits, recursively sanitize all children and keep the structure intact
  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = sanitizePaneLayout(child, liveSessionIds);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  // If no children changed, return the same node to preserve reference equality
  if (!changed) {
    return node;
  }

  // If all children collapsed to a single leaf, simplify
  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

function assignFirstDraftPane(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    if (!node.sessionId) {
      return {
        ...node,
        sessionId,
      };
    }

    return null;
  }

  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const nextChild = assignFirstDraftPane(child, sessionId);
    if (!nextChild) {
      continue;
    }

    return {
      ...node,
      children: children.map((candidate, candidateIndex) =>
        candidateIndex === index ? nextChild : candidate
      ),
    };
  }

  return null;
}

function splitLeafForNewSession(
  node: PaneNode,
  sessionId: string,
  direction: PaneDirection,
  preferredSessionId?: string
): PaneNode | null {
  if (node.type === "leaf") {
    if (!node.sessionId) {
      return null;
    }

    if (preferredSessionId && node.sessionId !== preferredSessionId) {
      return null;
    }

    const splitId = `split-${node.id}-${direction}-${Date.now()}`;
    return {
      id: splitId,
      type: "split",
      direction,
      ratio: 0.5,
      children: [{ ...node }, createSessionLeaf(`${splitId}-session`, sessionId)],
    };
  }

  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const nextChild = splitLeafForNewSession(child, sessionId, direction, preferredSessionId);
    if (!nextChild) {
      continue;
    }

    return {
      ...node,
      children: children.map((candidate, candidateIndex) =>
        candidateIndex === index ? nextChild : candidate
      ),
    };
  }

  return null;
}

function createFallbackPaneLayoutBranch(sessionIds: string[], startIndex: number): PaneNode {
  if (sessionIds.length === 1) {
    return {
      id: `fallback-leaf-${startIndex}`,
      type: "leaf",
      sessionId: sessionIds[0]!,
    };
  }

  const [firstId, ...rest] = sessionIds;
  return {
    id: `split-fallback-${startIndex}`,
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      {
        id: `fallback-leaf-${startIndex}`,
        type: "leaf",
        sessionId: firstId!,
      },
      createFallbackPaneLayoutBranch(rest, startIndex + 1),
    ],
  };
}
