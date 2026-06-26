import { useAtomValue } from "jotai";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { FC, WheelEvent } from "react";
import { useEffect, useState } from "react";
import { EmptyState, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { CanvasContent } from "../../../canvas/components/canvas-content";
import {
  canvasRefreshTokenAtomFamily,
  type WorkspaceCanvasEditorTab,
} from "../../../workspace/atoms";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function formatZoom(value: number): string {
  return `${Math.round(value * 100)}%`;
}

interface CanvasSurfaceProps {
  workspaceId: string;
  tab: WorkspaceCanvasEditorTab;
}

export const CanvasSurface: FC<CanvasSurfaceProps> = ({ workspaceId, tab }) => {
  const t = useTranslation();
  const sourcePath = tab.sourcePath.trim();
  const refreshToken = useAtomValue(canvasRefreshTokenAtomFamily({ workspaceId, sourcePath }));
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setZoom(1);
  }, [refreshToken, sourcePath]);

  if (!sourcePath) {
    return (
      <EmptyState
        className="git-diff-empty"
        title={<p className="git-diff-empty-title">{t("code_editor.preview_unavailable")}</p>}
      />
    );
  }

  const changeZoom = (delta: number) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  };

  const zoomOutDisabled = zoom <= MIN_ZOOM;
  const zoomInDisabled = zoom >= MAX_ZOOM;
  const resetDisabled = zoom === 1;

  return (
    <div className="document-preview canvas-surface">
      <div className="canvas-surface__viewport" onWheel={handleWheel}>
        <div
          className="canvas-surface__scaled-content"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: `${100 / zoom}%`,
          }}
        >
          <CanvasContent
            workspaceId={workspaceId}
            sourcePath={sourcePath}
            refreshToken={refreshToken}
            layout="inline"
          />
        </div>
      </div>
      <div
        className="canvas-surface__zoom-bar"
        role="toolbar"
        aria-label={t("code_editor.canvas_zoom_controls")}
      >
        <Tooltip content={t("code_editor.image_zoom_out")}>
          <IconButton
            aria-label={t("code_editor.image_zoom_out")}
            className="canvas-surface__zoom-btn"
            disabled={zoomOutDisabled}
            icon={<ZoomOut size={14} />}
            onClick={() => changeZoom(-ZOOM_STEP)}
            size="sm"
          />
        </Tooltip>
        <span className="canvas-surface__zoom-level" aria-label={t("code_editor.image_zoom_level")}>
          {formatZoom(zoom)}
        </span>
        <Tooltip content={t("code_editor.image_zoom_in")}>
          <IconButton
            aria-label={t("code_editor.image_zoom_in")}
            className="canvas-surface__zoom-btn"
            disabled={zoomInDisabled}
            icon={<ZoomIn size={14} />}
            onClick={() => changeZoom(ZOOM_STEP)}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("code_editor.canvas_zoom_reset")}>
          <IconButton
            aria-label={t("code_editor.canvas_zoom_reset")}
            className="canvas-surface__zoom-btn"
            disabled={resetDisabled}
            icon={<RotateCcw size={14} />}
            onClick={() => setZoom(1)}
            size="sm"
          />
        </Tooltip>
      </div>
    </div>
  );
};
