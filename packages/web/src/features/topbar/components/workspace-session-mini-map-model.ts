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

  return [
    ...collectCells(firstChild, sessionsById, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width * 0.5,
      height: bounds.height,
    }),
    ...collectCells(secondChild, sessionsById, {
      x: bounds.x + bounds.width * 0.5,
      y: bounds.y,
      width: bounds.width * 0.5,
      height: bounds.height,
    }),
  ];
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
