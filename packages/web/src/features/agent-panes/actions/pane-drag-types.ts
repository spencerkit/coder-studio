export type PaneDropPlacement = "left" | "right" | "top" | "bottom" | "center";

export type PaneDropTargetType = "session" | "draft";

export interface PaneDropIntent {
  sourcePaneId: string;
  targetPaneId: string;
  placement: PaneDropPlacement;
  targetType: PaneDropTargetType;
}
