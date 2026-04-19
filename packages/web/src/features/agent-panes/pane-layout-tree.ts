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
 * Sanitize pane layout: replace references to missing sessions with draft leaves.
 * Preserves the split structure while removing dead session references.
 */
export function sanitizePaneLayout(
  node: PaneNode,
  validSessionIds: Set<string>
): PaneNode {
  if (node.type === 'leaf') {
    if (node.sessionId && !validSessionIds.has(node.sessionId)) {
      return createDraftLeaf(node.id);
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = sanitizePaneLayout(child, validSessionIds);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  if (!changed) {
    return node;
  }

  // If all children became draft leaves and there are exactly 2, keep the split
  // If only 1 child remains after filtering, collapse the split
  const validChildren = nextChildren.filter(
    (c) => c.type === 'split' || (c.type === 'leaf' && c.sessionId)
  );

  if (validChildren.length === 1 && nextChildren.length > 1) {
    // Keep draft leaves alongside active sessions - don't collapse
    return {
      ...node,
      children: nextChildren,
    };
  }

  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  if (nextChildren.length === 0) {
    return createDraftLeaf(node.id);
  }

  return {
    ...node,
    children: nextChildren,
  };
}
