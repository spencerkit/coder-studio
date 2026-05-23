import type { Session, WorkspacePaneNode } from "@coder-studio/core";

export type WorkspaceSessionMiniMapState = "running" | "starting" | "idle" | "empty";

export interface WorkspaceSessionMiniMapCell {
  readonly paneId: string;
  readonly sessionId: string | null;
  readonly state: WorkspaceSessionMiniMapState;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PaneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type WorkspacePaneNodeLike = WorkspacePaneNode & {
  readonly ratio?: number;
  readonly children?: WorkspacePaneNodeLike[];
};

export function buildWorkspaceSessionMiniMapCells(
  layout: WorkspacePaneNodeLike | null | undefined,
  sessionsById: Record<string, Session>
): WorkspaceSessionMiniMapCell[] {
  const root: WorkspacePaneNodeLike = layout ?? { id: "root", type: "leaf" };
  return collectCells(root, sessionsById, { x: 0, y: 0, width: 1, height: 1 });
}

export function measureWorkspaceSessionMiniMapColumns(
  layout: WorkspacePaneNodeLike | null | undefined
): number {
  return countColumns(layout ?? { id: "root", type: "leaf" });
}

function collectCells(
  node: WorkspacePaneNodeLike,
  sessionsById: Record<string, Session>,
  bounds: PaneBounds
): WorkspaceSessionMiniMapCell[] {
  if (node.type !== "split" || !node.children?.length) {
    return [
      {
        paneId: node.id,
        sessionId: node.sessionId ?? null,
        state: resolveCellState(node.sessionId ? sessionsById[node.sessionId] : undefined),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    ];
  }

  const [firstChild, secondChild] = node.children;
  if (!firstChild || !secondChild) {
    return collectCells({ ...node, type: "leaf", children: undefined }, sessionsById, bounds);
  }

  if (node.direction === "horizontal") {
    const firstColumns = countColumns(firstChild);
    const secondColumns = countColumns(secondChild);
    const totalColumns = firstColumns + secondColumns;
    const firstWidth = bounds.width * (firstColumns / totalColumns);

    return [
      ...collectCells(firstChild, sessionsById, {
        x: bounds.x,
        y: bounds.y,
        width: firstWidth,
        height: bounds.height,
      }),
      ...collectCells(secondChild, sessionsById, {
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: bounds.width - firstWidth,
        height: bounds.height,
      }),
    ];
  }

  if (node.direction === "vertical") {
    return [
      ...collectCells(firstChild, sessionsById, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height * 0.5,
      }),
      ...collectCells(secondChild, sessionsById, {
        x: bounds.x,
        y: bounds.y + bounds.height * 0.5,
        width: bounds.width,
        height: bounds.height * 0.5,
      }),
    ];
  }

  return collectCells({ ...node, direction: "horizontal" }, sessionsById, bounds);
}

function resolveCellState(session: Session | undefined): WorkspaceSessionMiniMapState {
  switch (session?.state) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "idle":
      return "idle";
    default:
      return "empty";
  }
}

function countColumns(node: WorkspacePaneNodeLike): number {
  if (node.type !== "split" || !node.children?.length) {
    return 1;
  }

  const [firstChild, secondChild] = node.children;
  if (!firstChild || !secondChild) {
    return 1;
  }

  if (node.direction === "vertical") {
    return Math.max(countColumns(firstChild), countColumns(secondChild));
  }

  return countColumns(firstChild) + countColumns(secondChild);
}
