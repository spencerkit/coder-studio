import type { SessionPaneNode } from "../../state/workbench.ts";

export const collectPaneLeaves = (node: SessionPaneNode): Array<{ id: string; sessionId: string }> => {
  if (node.type === "leaf") {
    return [{ id: node.id, sessionId: node.sessionId }];
  }
  return [...collectPaneLeaves(node.first), ...collectPaneLeaves(node.second)];
};

export const findPaneSessionId = (node: SessionPaneNode, paneId: string): string | null => {
  if (node.type === "leaf") {
    return node.id === paneId ? node.sessionId : null;
  }
  return findPaneSessionId(node.first, paneId) ?? findPaneSessionId(node.second, paneId);
};

export const findPaneIdBySessionId = (node: SessionPaneNode, sessionId: string): string | null => {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? node.id : null;
  }
  return findPaneIdBySessionId(node.first, sessionId) ?? findPaneIdBySessionId(node.second, sessionId);
};

export const replacePaneNode = (
  node: SessionPaneNode,
  paneId: string,
  updater: (leaf: Extract<SessionPaneNode, { type: "leaf" }>) => SessionPaneNode
): SessionPaneNode => {
  if (node.type === "leaf") {
    return node.id === paneId ? updater(node) : node;
  }
  return {
    ...node,
    first: replacePaneNode(node.first, paneId, updater),
    second: replacePaneNode(node.second, paneId, updater)
  };
};

export const removePaneNode = (node: SessionPaneNode, paneId: string): SessionPaneNode | null => {
  if (node.type === "leaf") {
    return node.id === paneId ? null : node;
  }

  const nextFirst = removePaneNode(node.first, paneId);
  const nextSecond = removePaneNode(node.second, paneId);

  if (!nextFirst && !nextSecond) return null;
  if (!nextFirst) return nextSecond;
  if (!nextSecond) return nextFirst;

  return {
    ...node,
    first: nextFirst,
    second: nextSecond
  };
};

export const remapPaneSession = (node: SessionPaneNode, fromSessionId: string, toSessionId: string): SessionPaneNode => {
  if (node.type === "leaf") {
    return node.sessionId === fromSessionId
      ? { ...node, sessionId: toSessionId }
      : node;
  }
  return {
    ...node,
    first: remapPaneSession(node.first, fromSessionId, toSessionId),
    second: remapPaneSession(node.second, fromSessionId, toSessionId)
  };
};

export const updateSplitRatio = (node: SessionPaneNode, splitId: string, ratio: number): SessionPaneNode => {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    return {
      ...node,
      ratio
    };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio)
  };
};
