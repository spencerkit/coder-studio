import type { PaneNode } from "./atoms/pane-layout";

type PaneDirection = NonNullable<PaneNode["direction"]>;
type PaneDropPlacement = "left" | "right" | "top" | "bottom" | "center";

function isLegacyLeaf(node: PaneNode): boolean {
  return node.type === "leaf" && node.leafKind === undefined;
}

function isDraftLeaf(node: PaneNode): boolean {
  return node.type === "leaf" && (node.leafKind === "draft" || (!node.leafKind && !node.sessionId));
}

function isSessionLeaf(node: PaneNode): boolean {
  return node.type === "leaf" && (node.leafKind === "session" || Boolean(node.sessionId));
}

function isEditorLeaf(node: PaneNode): boolean {
  return node.type === "leaf" && node.leafKind === "editor";
}

export function paneLayoutHasEditorPaneId(node: PaneNode, paneId: string): boolean {
  const leaf = findLeafByPaneId(node, paneId);
  return leaf ? isEditorLeaf(leaf) : false;
}

function createDraftLeaf(id: string, legacy = false): PaneNode {
  return {
    id,
    type: "leaf",
    ...(legacy ? {} : { leafKind: "draft" }),
  };
}

function createSessionLeaf(id: string, sessionId: string, legacy = false): PaneNode {
  return {
    id,
    type: "leaf",
    sessionId,
    ...(legacy ? {} : { leafKind: "session" }),
  };
}

function createEditorLeaf(id: string): PaneNode {
  return {
    id,
    type: "leaf",
    leafKind: "editor",
  };
}

function createDragSplitId(
  targetPaneId: string,
  placement: Exclude<PaneDropPlacement, "center">
): string {
  return `split-${targetPaneId}-${placement}-${Date.now()}`;
}

function findLeafByPaneId(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.id === paneId ? node : null;
  }

  for (const child of node.children ?? []) {
    const match = findLeafByPaneId(child, paneId);
    if (match) {
      return match;
    }
  }

  return null;
}

function replaceLeafByPaneId(
  node: PaneNode,
  paneId: string,
  replace: (leaf: PaneNode) => PaneNode
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) {
      return node;
    }

    return replace(node);
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = replaceLeafByPaneId(child, paneId, replace);
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

function removeLeafByPaneId(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") {
    if (node.id === paneId) {
      return null;
    }

    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren: PaneNode[] = [];
  for (const child of children) {
    const nextChild = removeLeafByPaneId(child, paneId);
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
      children: [{ ...node }, createDraftLeaf(`${splitId}-draft`, isLegacyLeaf(node))],
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
      children: [{ ...node }, createDraftLeaf(`${splitId}-draft`, isLegacyLeaf(node))],
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

    return createSessionLeaf(node.id, sessionId, isLegacyLeaf(node));
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

export function replaceSessionInPane(
  node: PaneNode,
  previousSessionId: string,
  nextSessionId: string
): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== previousSessionId) {
      return node;
    }

    return createSessionLeaf(node.id, nextSessionId, isLegacyLeaf(node));
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = replaceSessionInPane(child, previousSessionId, nextSessionId);
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

export function swapPaneSessionsByPaneId(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target?.sessionId) {
    return node;
  }

  const withSourceSwapped = replaceLeafByPaneId(node, sourcePaneId, (leaf) => ({
    ...leaf,
    sessionId: target.sessionId,
  }));

  return replaceLeafByPaneId(withSourceSwapped, targetPaneId, (leaf) => ({
    ...leaf,
    sessionId: source.sessionId!,
  }));
}

export function moveSessionToDraftPane(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target || target.sessionId) {
    return node;
  }

  const stripped =
    removeLeafByPaneId(node, sourcePaneId) ??
    createDraftLeaf(node.id, node.type === "leaf" && isLegacyLeaf(node));
  return assignSessionToPane(stripped, targetPaneId, source.sessionId);
}

export function insertPaneAtEdge(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string,
  placement: Exclude<PaneDropPlacement, "center">
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target?.sessionId) {
    return node;
  }

  const stripped =
    removeLeafByPaneId(node, sourcePaneId) ??
    createDraftLeaf(node.id, node.type === "leaf" && isLegacyLeaf(node));
  const incomingLeaf = createSessionLeaf(source.id, source.sessionId, isLegacyLeaf(source));

  return replaceLeafByPaneId(stripped, targetPaneId, (leaf) => ({
    id: createDragSplitId(leaf.id, placement),
    type: "split",
    direction: placement === "left" || placement === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    children:
      placement === "left" || placement === "top" ? [incomingLeaf, leaf] : [leaf, incomingLeaf],
  }));
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
    if (node.id === paneId && isDraftLeaf(node)) {
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
  return (
    closeDraftPane(node, paneId) ??
    createDraftLeaf(node.id, node.type === "leaf" && isLegacyLeaf(node))
  );
}

export function convertDraftPaneToEditor(node: PaneNode, paneId: string): PaneNode {
  return replaceLeafByPaneId(node, paneId, (leaf) => {
    if (!isDraftLeaf(leaf)) {
      return leaf;
    }

    return createEditorLeaf(leaf.id);
  });
}

export function closeEditorPaneById(node: PaneNode, paneId: string): PaneNode {
  return replaceLeafByPaneId(node, paneId, (leaf) => {
    if (!isEditorLeaf(leaf)) {
      return leaf;
    }

    return createDraftLeaf(leaf.id);
  });
}

/**
 * Close a session pane by turning it into a draft leaf while preserving the
 * existing split structure. This matches the desktop session-card close behavior:
 * the session ends, but the workspace layout remains stable so the user can
 * immediately launch a replacement session in the same pane.
 */
function replaceSessionWithDraft(node: PaneNode, sessionId: string): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId === sessionId) {
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

export function removePaneBySessionId(node: PaneNode, sessionId: string): PaneNode {
  return (
    removeSessionPane(node, sessionId) ??
    createDraftLeaf(node.id, node.type === "leaf" && isLegacyLeaf(node))
  );
}

function removeSessionPane(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    if (node.sessionId === sessionId) {
      return null;
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren: PaneNode[] = [];
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

export function paneLayoutHasSession(node: PaneNode, sessionIds: Set<string>): boolean {
  if (node.type === "leaf") {
    return isSessionLeaf(node) && node.sessionId ? sessionIds.has(node.sessionId) : false;
  }

  return node.children?.some((child) => paneLayoutHasSession(child, sessionIds)) ?? false;
}

export function paneLayoutReferencesMissingSession(
  node: PaneNode,
  sessionIds: Set<string>
): boolean {
  if (node.type === "leaf") {
    return isSessionLeaf(node) && node.sessionId ? !sessionIds.has(node.sessionId) : false;
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
    return isSessionLeaf(node) && node.sessionId ? [node.sessionId] : [];
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

  const anyLeafSplit = splitAnyLeafForNewSession(node, sessionId, direction);
  if (anyLeafSplit) {
    return anyLeafSplit;
  }

  if (node.type === "leaf" && isDraftLeaf(node)) {
    return createSessionLeaf(node.id, sessionId, isLegacyLeaf(node));
  }

  return createSessionLeaf("root", sessionId);
}

export function appendSessionToWidestColumn(node: PaneNode, sessionId: string): PaneNode {
  const draftFilled = assignFirstDraftPane(node, sessionId);
  if (draftFilled) {
    return draftFilled;
  }

  const widestColumnSplit = splitWidestColumnForNewSession(node, sessionId);
  if (widestColumnSplit) {
    return widestColumnSplit;
  }

  return appendSessionToLayout(node, sessionId, undefined, "horizontal");
}

export function createFallbackPaneLayout(sessionIds: string[]): PaneNode {
  if (sessionIds.length === 0) {
    return createDraftLeaf("root");
  }

  if (sessionIds.length === 1) {
    return createSessionLeaf("fallback-leaf-1", sessionIds[0]!);
  }

  const [firstId, ...rest] = sessionIds;
  return {
    id: "split-fallback-1",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      createSessionLeaf("fallback-leaf-1", firstId!),
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
    // If this leaf references a session that is ended or removed, turn it into a draft.
    if (isSessionLeaf(node) && node.sessionId && !liveSessionIds.has(node.sessionId)) {
      return createDraftLeaf(node.id, isLegacyLeaf(node));
    }
    return node;
  }

  const children = node.children ?? [];
  let changed = false;
  const nextChildren = children.map((child) => {
    const nextChild = sanitizePaneLayout(child, liveSessionIds);
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

function assignFirstDraftPane(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    if (isDraftLeaf(node)) {
      return createSessionLeaf(node.id, sessionId, isLegacyLeaf(node));
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
    if (!isSessionLeaf(node) || !node.sessionId) {
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
      children: [
        { ...node },
        createSessionLeaf(`${splitId}-session`, sessionId, isLegacyLeaf(node)),
      ],
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

function splitAnyLeafForNewSession(
  node: PaneNode,
  sessionId: string,
  direction: PaneDirection
): PaneNode | null {
  if (node.type === "leaf") {
    if (isDraftLeaf(node)) {
      return null;
    }

    const splitId = `split-${node.id}-${direction}-${Date.now()}`;
    return {
      id: splitId,
      type: "split",
      direction,
      ratio: 0.5,
      children: [
        { ...node },
        createSessionLeaf(`${splitId}-session`, sessionId, isLegacyLeaf(node)),
      ],
    };
  }

  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const nextChild = splitAnyLeafForNewSession(child, sessionId, direction);
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

interface ColumnCandidate {
  path: number[];
  width: number;
}

function splitWidestColumnForNewSession(node: PaneNode, sessionId: string): PaneNode | null {
  const candidate = findWidestColumnCandidate(node);
  if (!candidate) {
    return null;
  }

  return replaceNodeAtPath(node, candidate.path, (target) => {
    const splitId = `split-${target.id}-horizontal-${Date.now()}`;
    const legacy = target.type === "leaf" && isLegacyLeaf(target);
    return {
      id: splitId,
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [{ ...target }, createSessionLeaf(`${splitId}-session`, sessionId, legacy)],
    };
  });
}

function findWidestColumnCandidate(
  node: PaneNode,
  width = 1,
  path: number[] = []
): ColumnCandidate | null {
  if (node.type === "leaf") {
    if (!isSessionLeaf(node) || !node.sessionId) {
      return null;
    }

    return {
      path,
      width,
    };
  }

  const children = node.children ?? [];
  if (children.length === 0) {
    return null;
  }

  if (node.direction === "vertical") {
    return subtreeHasSession(node)
      ? {
          path,
          width,
        }
      : null;
  }

  const ratio = node.ratio ?? 0.5;
  const firstWidth = width * ratio;
  const secondWidth = width * (1 - ratio);

  const firstCandidate = findWidestColumnCandidate(children[0]!, firstWidth, [...path, 0]);
  const secondCandidate = findWidestColumnCandidate(children[1]!, secondWidth, [...path, 1]);

  return chooseWiderCandidate(firstCandidate, secondCandidate);
}

function subtreeHasSession(node: PaneNode): boolean {
  if (node.type === "leaf") {
    return isSessionLeaf(node) && Boolean(node.sessionId);
  }

  return (node.children ?? []).some((child) => subtreeHasSession(child));
}

function chooseWiderCandidate(
  ...candidates: Array<ColumnCandidate | null>
): ColumnCandidate | null {
  let best: ColumnCandidate | null = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!best || candidate.width > best.width) {
      best = candidate;
    }
  }

  return best;
}

function replaceNodeAtPath(
  node: PaneNode,
  path: number[],
  replace: (target: PaneNode) => PaneNode
): PaneNode {
  if (path.length === 0) {
    return replace(node);
  }

  if (node.type === "leaf") {
    return node;
  }

  const [index, ...rest] = path;
  const children = node.children ?? [];

  return {
    ...node,
    children: children.map((child, childIndex) =>
      childIndex === index ? replaceNodeAtPath(child, rest, replace) : child
    ),
  };
}

function createFallbackPaneLayoutBranch(sessionIds: string[], startIndex: number): PaneNode {
  if (sessionIds.length === 1) {
    return createSessionLeaf(`fallback-leaf-${startIndex}`, sessionIds[0]!);
  }

  const [firstId, ...rest] = sessionIds;
  return {
    id: `split-fallback-${startIndex}`,
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      createSessionLeaf(`fallback-leaf-${startIndex}`, firstId!),
      createFallbackPaneLayoutBranch(rest, startIndex + 1),
    ],
  };
}
