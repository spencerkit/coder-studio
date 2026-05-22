import type { CSSProperties } from "react";
import type { WorkspaceSessionMiniMapCell } from "./workspace-session-mini-map-model";

interface WorkspaceSessionMiniMapProps {
  readonly cells: WorkspaceSessionMiniMapCell[];
}

export function WorkspaceSessionMiniMap({ cells }: WorkspaceSessionMiniMapProps) {
  return (
    <span
      aria-hidden="true"
      className="workspace-session-mini-map"
      data-testid="workspace-session-mini-map"
    >
      {cells.map((cell) => (
        <span
          key={cell.paneId}
          className={`workspace-session-mini-map__cell workspace-session-mini-map__cell--${cell.state}`}
          style={
            {
              left: `${cell.x * 100}%`,
              top: `${cell.y * 100}%`,
              width: `${cell.width * 100}%`,
              height: `${cell.height * 100}%`,
              "--workspace-session-map-cell-x": `${cell.x * 100}%`,
              "--workspace-session-map-cell-y": `${cell.y * 100}%`,
              "--workspace-session-map-cell-width": `${cell.width * 100}%`,
              "--workspace-session-map-cell-height": `${cell.height * 100}%`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
