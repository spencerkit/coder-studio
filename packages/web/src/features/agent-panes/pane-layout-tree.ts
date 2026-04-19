import type { PaneNode } from '../../atoms/ui';

type PaneDirection = NonNullable<PaneNode['direction']>;

function createDraftLeaf(id: string): PaneNode {
  return {
    id,
    type: 'leaf',
  };
}

export function splitPaneBySessionId(
  node: PaneNode,
  sessionId: string,
  direction: PaneDirection
): PaneNode {
  if (node.type === 'leaf') {
    if (node.sessionId !== sessionId) {
      return node;
    }

    const splitId = `split-${node.id}-${direction}-${Date.now()}`;
    return {
      id: splitId,
      type: 'split',
      direction,
      ratio: 0.5,
      children: [
        { ...node },
        createDraftLeaf(`${splitId}-draft`),
      ],
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
  if (node.type === 'leaf') {
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
  const nextNode = closeNode(node, sessionId);

  return nextNode ?? createDraftLeaf(node.id);
}

function closeNode(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? null : node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children
    .map((child) => {
      const nextChild = closeNode(child, sessionId);
      if (nextChild !== child) {
        changed = true;
      }
      return nextChild;
    })
    .filter((child): child is PaneNode => child !== null);

  if (!changed) {
    return node;
  }

  if (nextChildren.length === 0) {
    return null;
  }

  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

export function paneLayoutHasSession(node: PaneNode, sessionIds: Set<string>): boolean {
  if (node.type === 'leaf') {
    return node.sessionId ? sessionIds.has(node.sessionId) : false;
  }

  return node.children?.some((child) => paneLayoutHasSession(child, sessionIds)) ?? false;
}

export function paneLayoutReferencesMissingSession(
  node: PaneNode,
  sessionIds: Set<string>
): boolean {
  if (node.type === 'leaf') {
    return node.sessionId ? !sessionIds.has(node.sessionId) : false;
  }

  return (
    node.children?.some((child) => paneLayoutReferencesMissingSession(child, sessionIds)) ?? false
  );
}

/**
 * Sanitize pane layout: replace references to ended/removed sessions with draft leaves.
 * Preserves the entire split structure so layout is maintained on page refresh.
 */
export function sanitizePaneLayout(
  node: PaneNode,
  liveSessionIds: Set<string>
): PaneNode {
  if (node.type === 'leaf') {
    // If this leaf references a session that is ended or removed, turn it into a draft
    if (node.sessionId && !liveSessionIds.has(node.sessionId)) {
      return { id: node.id, type: 'leaf' };
    }
    return node;
  }

  // For splits, recursively sanitize all children and keep the structure intact
  const children = node.children ?? [];
  const nextChildren = children.map((child) => sanitizePaneLayout(child, liveSessionIds));

  // If all children collapsed to a single leaf, simplify
  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  return {
    ...node,
    children: nextChildren,
  };
}
