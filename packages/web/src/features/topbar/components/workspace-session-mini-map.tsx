import type { CSSProperties } from "react";
import type {
  WorkspaceSessionMiniMapCell,
  WorkspaceSessionMiniMapState,
} from "./workspace-session-mini-map-model";

interface WorkspaceSessionMiniMapProps {
  readonly cells: WorkspaceSessionMiniMapCell[];
  readonly columns?: number;
}

interface WorkspaceSessionMiniMapColumn {
  readonly id: string;
  readonly fill: string;
}

interface WorkspaceSessionMiniMapColumnSegment {
  readonly top: number;
  readonly bottom: number;
  readonly state: WorkspaceSessionMiniMapState;
}

const WORKSPACE_SESSION_MINI_MAP_STATE_COLOR: Record<WorkspaceSessionMiniMapState, string> = {
  running: "var(--workspace-session-map-running)",
  starting: "var(--workspace-session-map-starting)",
  idle: "var(--workspace-session-map-idle)",
  empty: "var(--workspace-session-map-empty)",
};

export function WorkspaceSessionMiniMap({ cells, columns = 1 }: WorkspaceSessionMiniMapProps) {
  const resolvedColumns = Math.max(columns, 1);
  const columnFills = buildWorkspaceSessionMiniMapColumnFills(cells, resolvedColumns);
  const mapStyle = {
    "--workspace-session-map-columns": String(resolvedColumns),
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className="workspace-session-mini-map"
      data-testid="workspace-session-mini-map"
      style={mapStyle}
    >
      <span className="workspace-session-mini-map__viewport">
        {columnFills.map((column) => (
          <span
            key={column.id}
            className="workspace-session-mini-map__column"
            style={
              {
                "--workspace-session-map-column-fill": column.fill,
              } as CSSProperties
            }
          />
        ))}
      </span>
    </span>
  );
}

function buildWorkspaceSessionMiniMapColumnFills(
  cells: WorkspaceSessionMiniMapCell[],
  columnCount: number
): WorkspaceSessionMiniMapColumn[] {
  const segmentsByColumn = Array.from(
    { length: columnCount },
    () => [] as WorkspaceSessionMiniMapColumnSegment[]
  );

  for (const cell of cells) {
    const startColumn = clampColumnIndex(Math.round(cell.x * columnCount), columnCount);
    const columnSpan = Math.max(1, Math.round(cell.width * columnCount));
    const lastColumn = clampColumnIndex(startColumn + columnSpan - 1, columnCount);
    const segment = {
      top: clampRatio(cell.y),
      bottom: clampRatio(cell.y + cell.height),
      state: cell.state,
    } satisfies WorkspaceSessionMiniMapColumnSegment;

    for (let columnIndex = startColumn; columnIndex <= lastColumn; columnIndex += 1) {
      segmentsByColumn[columnIndex]?.push(segment);
    }
  }

  return segmentsByColumn.map((segments, index) => ({
    id: `column-${index}`,
    fill: buildWorkspaceSessionMiniMapColumnFill(segments),
  }));
}

function buildWorkspaceSessionMiniMapColumnFill(
  segments: WorkspaceSessionMiniMapColumnSegment[]
): string {
  const orderedSegments = segments
    .filter((segment) => segment.bottom > segment.top)
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom);

  if (orderedSegments.length === 0) {
    return buildSolidColumnFill("empty");
  }

  const stops: string[] = [];
  const segmentSize = 1 / orderedSegments.length;

  for (const [index, segment] of orderedSegments.entries()) {
    const start = index * segmentSize;
    const end = (index + 1) * segmentSize;
    appendColumnFillStops(stops, segment.state, start, end);
  }

  return `linear-gradient(180deg, ${stops.join(", ")})`;
}

function appendColumnFillStops(
  stops: string[],
  state: WorkspaceSessionMiniMapState,
  start: number,
  end: number
) {
  const color = WORKSPACE_SESSION_MINI_MAP_STATE_COLOR[state];
  stops.push(`${color} ${formatStopPercentage(start)}`);
  stops.push(`${color} ${formatStopPercentage(end)}`);
}

function buildSolidColumnFill(state: WorkspaceSessionMiniMapState): string {
  const color = WORKSPACE_SESSION_MINI_MAP_STATE_COLOR[state];
  return `linear-gradient(180deg, ${color} 0%, ${color} 100%)`;
}

function clampColumnIndex(value: number, columnCount: number): number {
  return Math.max(0, Math.min(columnCount - 1, value));
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatStopPercentage(value: number): string {
  const percentage = Math.round(clampRatio(value) * 1000) / 10;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}
