import type { WorkspacePaneNode } from "@coder-studio/core";

export type PaneDisposition = "draft" | "remove";

function isLegacyLeaf(node: WorkspacePaneNode): boolean {
  return node.type === "leaf" && node.leafKind === undefined;
}

function createDraftLeaf(id: string, legacy = false): WorkspacePaneNode {
  return legacy ? { id, type: "leaf" } : { id, type: "leaf", leafKind: "draft" };
}

export function applyPaneDisposition(
  layout: WorkspacePaneNode | undefined,
  sessionId: string,
  disposition: PaneDisposition
): WorkspacePaneNode | undefined {
  if (!layout) {
    return layout;
  }

  return disposition === "remove"
    ? removePaneBySessionId(layout, sessionId)
    : closePaneBySessionId(layout, sessionId);
}

function closePaneBySessionId(node: WorkspacePaneNode, sessionId: string): WorkspacePaneNode {
  return replaceSessionWithDraft(node, sessionId);
}

function replaceSessionWithDraft(node: WorkspacePaneNode, sessionId: string): WorkspacePaneNode {
  if (node.type === "leaf") {
    if ("sessionId" in node && node.sessionId === sessionId) {
      return createDraftLeaf(node.id, isLegacyLeaf(node));
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

function removePaneBySessionId(node: WorkspacePaneNode, sessionId: string): WorkspacePaneNode {
  return removeSessionPane(node, sessionId) ?? createDraftLeaf(node.id, isLegacyLeaf(node));
}

function removeSessionPane(node: WorkspacePaneNode, sessionId: string): WorkspacePaneNode | null {
  if (node.type === "leaf") {
    if ("sessionId" in node && node.sessionId === sessionId) {
      return null;
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren: WorkspacePaneNode[] = [];

  for (const child of children) {
    const nextChild = removeSessionPane(child, sessionId);
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
