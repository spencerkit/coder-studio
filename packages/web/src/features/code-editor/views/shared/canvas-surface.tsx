import { useAtomValue } from "jotai";
import { RotateCcw, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { FC, WheelEvent } from "react";
import { useEffect, useState } from "react";
import { Button, EmptyState, IconButton, Notice, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  type CanvasAnnotationCommand,
  type CanvasAnnotationTool,
  CanvasContent,
  type CanvasContentExportState,
} from "../../../canvas/components/canvas-content";
import { exportCanvasPng } from "../../../canvas/utils/export-canvas-png";
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

function buildCanvasExportFilename(input: { sourcePath: string; title: string }): string {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length > 0) {
    return `${trimmedTitle}.png`;
  }

  const sourceFile = input.sourcePath.split("/").pop() ?? "canvas";
  const basename = sourceFile.replace(/\.[^.]+$/, "");
  return `${basename}.canvas.png`;
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
  const [annotationTool, setAnnotationTool] = useState<CanvasAnnotationTool>("select");
  const [annotationCommand, setAnnotationCommand] = useState<CanvasAnnotationCommand | null>(null);
  const [exportMode, setExportMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [contentExportState, setContentExportState] = useState<CanvasContentExportState>({
    exportRoot: null,
    hasUnsavedCommentDraft: false,
    ready: false,
  });

  useEffect(() => {
    setZoom(1);
    setAnnotationTool("select");
    setAnnotationCommand(null);
    setExportMode(false);
    setExporting(false);
    setExportError(null);
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
  const issueAnnotationCommand = (type: CanvasAnnotationCommand["type"]) => {
    setAnnotationCommand({
      id: Date.now(),
      type,
    });
  };

  const handleExportPng = async () => {
    if (contentExportState.hasUnsavedCommentDraft) {
      setExportError(t("code_editor.canvas_export_unsaved_comment"));
      return;
    }

    if (!contentExportState.ready || !contentExportState.exportRoot) {
      setExportError(t("code_editor.canvas_export_unavailable"));
      return;
    }

    try {
      setExportError(null);
      setExporting(true);
      setExportMode(true);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      await exportCanvasPng({
        element: contentExportState.exportRoot,
        filename: buildCanvasExportFilename({
          sourcePath,
          title: tab.title,
        }),
      });
    } catch {
      setExportError(t("code_editor.canvas_export_failed"));
    } finally {
      setExportMode(false);
      setExporting(false);
    }
  };

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
            editable
            exportMode={exportMode}
            inspectionEnabled
            annotationCommand={annotationCommand}
            annotationTool={annotationTool}
            onExportStateChange={setContentExportState}
          />
        </div>
      </div>
      {exportError ? <Notice message={exportError} role="alert" tone="error" /> : null}
      <div className="canvas-surface__controls">
        <div
          className="canvas-surface__annotation-bar"
          role="toolbar"
          aria-label={t("code_editor.canvas_annotation_toolbar")}
        >
          <Tooltip content={t("code_editor.canvas_annotation_select")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_select")}
              aria-pressed={annotationTool === "select"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "select" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">S</span>}
              onClick={() => setAnnotationTool("select")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_inspect")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_inspect")}
              aria-pressed={annotationTool === "inspect"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "inspect" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">I</span>}
              onClick={() => setAnnotationTool("inspect")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_pen")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_pen")}
              aria-pressed={annotationTool === "pen"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "pen" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">P</span>}
              onClick={() => setAnnotationTool("pen")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_arrow")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_arrow")}
              aria-pressed={annotationTool === "arrow"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "arrow" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">A</span>}
              onClick={() => setAnnotationTool("arrow")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_rect")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_rect")}
              aria-pressed={annotationTool === "rect"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "rect" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">R</span>}
              onClick={() => setAnnotationTool("rect")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_text")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_text")}
              aria-pressed={annotationTool === "text"}
              className={`canvas-surface__annotation-btn${
                annotationTool === "text" ? " canvas-surface__annotation-btn--active" : ""
              }`}
              icon={<span className="canvas-surface__tool-glyph">T</span>}
              onClick={() => setAnnotationTool("text")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_delete")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_delete")}
              className="canvas-surface__annotation-btn"
              icon={<Trash2 size={14} />}
              onClick={() => issueAnnotationCommand("delete-selected")}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.canvas_annotation_clear")}>
            <IconButton
              aria-label={t("code_editor.canvas_annotation_clear")}
              className="canvas-surface__annotation-btn"
              icon={<X size={14} />}
              onClick={() => issueAnnotationCommand("clear-all")}
              size="sm"
            />
          </Tooltip>
        </div>
        <div className="canvas-surface__export-bar">
          <Button
            disabled={!contentExportState.ready || exporting}
            onClick={() => {
              void handleExportPng();
            }}
            size="sm"
            variant="secondary"
          >
            {exporting
              ? t("code_editor.canvas_export_in_progress")
              : t("code_editor.canvas_export_png")}
          </Button>
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
          <span
            className="canvas-surface__zoom-level"
            aria-label={t("code_editor.image_zoom_level")}
          >
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
    </div>
  );
};
