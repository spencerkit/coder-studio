import type { PaneNode } from "./atoms/pane-layout";

export type PaneDirection = "left" | "right" | "up" | "down";

interface PaneRect {
  sessionId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ROOT_RECT = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
} as const;

const EPSILON = 1e-9;

export function findAdjacentSessionId(
  layout: PaneNode,
  activeSessionId: string,
  direction: PaneDirection
): string | null {
  const leaves = collectSessionRects(layout, ROOT_RECT);
  const activeRect = leaves.find((leaf) => leaf.sessionId === activeSessionId);
  if (!activeRect) {
    return null;
  }

  let bestCandidate: PaneRect | null = null;
  let bestOverlap = false;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDelta = Number.POSITIVE_INFINITY;

  for (const candidate of leaves) {
    if (candidate.sessionId === activeSessionId) {
      continue;
    }

    const edgeDistance = getDirectionalEdgeDistance(activeRect, candidate, direction);
    if (edgeDistance === null) {
      continue;
    }

    const overlaps = hasPerpendicularOverlap(activeRect, candidate, direction);
    const centerDelta = getPerpendicularCenterDelta(activeRect, candidate, direction);

    if (
      bestCandidate === null ||
      (overlaps && !bestOverlap) ||
      (overlaps === bestOverlap && edgeDistance < bestEdgeDistance - EPSILON) ||
      (overlaps === bestOverlap &&
        Math.abs(edgeDistance - bestEdgeDistance) <= EPSILON &&
        centerDelta < bestCenterDelta - EPSILON)
    ) {
      bestCandidate = candidate;
      bestOverlap = overlaps;
      bestEdgeDistance = edgeDistance;
      bestCenterDelta = centerDelta;
    }
  }

  return bestCandidate?.sessionId ?? null;
}

function collectSessionRects(
  node: PaneNode,
  rect: { left: number; top: number; right: number; bottom: number }
): PaneRect[] {
  if (node.type === "leaf") {
    return node.sessionId ? [{ sessionId: node.sessionId, ...rect }] : [];
  }

  const children = node.children ?? [];
  if (children.length === 0) {
    return [];
  }

  if (children.length === 1) {
    return collectSessionRects(children[0]!, rect);
  }

  const ratio = node.ratio ?? 0.5;
  if (node.direction === "horizontal") {
    const splitX = rect.left + (rect.right - rect.left) * ratio;
    return [
      ...collectSessionRects(children[0]!, { ...rect, right: splitX }),
      ...collectSessionRects(children[1]!, { ...rect, left: splitX }),
    ];
  }

  const splitY = rect.top + (rect.bottom - rect.top) * ratio;
  return [
    ...collectSessionRects(children[0]!, { ...rect, bottom: splitY }),
    ...collectSessionRects(children[1]!, { ...rect, top: splitY }),
  ];
}

function getDirectionalEdgeDistance(
  activeRect: PaneRect,
  candidate: PaneRect,
  direction: PaneDirection
): number | null {
  switch (direction) {
    case "left": {
      const distance = activeRect.left - candidate.right;
      return distance >= -EPSILON ? Math.max(distance, 0) : null;
    }
    case "right": {
      const distance = candidate.left - activeRect.right;
      return distance >= -EPSILON ? Math.max(distance, 0) : null;
    }
    case "up": {
      const distance = activeRect.top - candidate.bottom;
      return distance >= -EPSILON ? Math.max(distance, 0) : null;
    }
    case "down": {
      const distance = candidate.top - activeRect.bottom;
      return distance >= -EPSILON ? Math.max(distance, 0) : null;
    }
  }
}

function hasPerpendicularOverlap(
  activeRect: PaneRect,
  candidate: PaneRect,
  direction: PaneDirection
): boolean {
  if (direction === "left" || direction === "right") {
    return spansOverlap(activeRect.top, activeRect.bottom, candidate.top, candidate.bottom);
  }

  return spansOverlap(activeRect.left, activeRect.right, candidate.left, candidate.right);
}

function getPerpendicularCenterDelta(
  activeRect: PaneRect,
  candidate: PaneRect,
  direction: PaneDirection
): number {
  if (direction === "left" || direction === "right") {
    return Math.abs(
      getCenter(activeRect.top, activeRect.bottom) - getCenter(candidate.top, candidate.bottom)
    );
  }

  return Math.abs(
    getCenter(activeRect.left, activeRect.right) - getCenter(candidate.left, candidate.right)
  );
}

function spansOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) - Math.max(startA, startB) > EPSILON;
}

function getCenter(start: number, end: number): number {
  return (start + end) / 2;
}
