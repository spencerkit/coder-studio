/**
 * ImagePreview — renders a workspace image inside the code-editor body.
 *
 * Sits inside the same `.code-editor-body` chrome that Monaco uses, so the
 * surrounding frame (header, border, shadow) matches the Git Diff viewer
 * and the text editor. The image itself is loaded via the `/api/file`
 * HTTP endpoint so large images don't have to travel over the WS channel.
 */

import { Maximize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import type { CSSProperties, FC, PointerEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, IconButton, Tooltip } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

interface ImagePreviewProps {
  url: string;
  version: string;
  mime: string;
  sizeBytes: number;
  alt: string;
}

type ZoomMode = "fit" | "manual";

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  translateX: number;
  translateY: number;
}

interface PanOffset {
  x: number;
  y: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mimeToLabel(mime: string): string {
  // "image/png" → "PNG", "image/svg+xml" → "SVG", "image/x-icon" → "ICO"
  const sub = mime.split("/")[1] ?? mime;
  const head = (sub.split("+")[0] ?? sub).replace(/^x-/, "");
  return head.toUpperCase();
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function formatZoom(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clampPanOffset(
  next: PanOffset,
  dimensions: { w: number; h: number } | null,
  zoom: number,
  canvas: HTMLDivElement | null
): PanOffset {
  if (!dimensions || !canvas) {
    return { x: 0, y: 0 };
  }

  const maxOffsetX = Math.max(0, (dimensions.w * zoom - canvas.clientWidth) / 2);
  const maxOffsetY = Math.max(0, (dimensions.h * zoom - canvas.clientHeight) / 2);

  return {
    x: Math.min(maxOffsetX, Math.max(-maxOffsetX, next.x)),
    y: Math.min(maxOffsetY, Math.max(-maxOffsetY, next.y)),
  };
}

export const ImagePreview: FC<ImagePreviewProps> = ({ url, version, mime, sizeBytes, alt }) => {
  const t = useTranslation();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [errored, setErrored] = useState(false);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<PanOffset>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const src = `${url}${url.includes("?") ? "&" : "?"}v=${version}`;

  useEffect(() => {
    // Reset when the underlying image changes so stale dimensions from the
    // previous file don't get shown for a frame.
    setDimensions(null);
    setErrored(false);
    setZoomMode("fit");
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    panStateRef.current = null;
    setIsPanning(false);
  }, [url, version]);

  const changeZoom = (delta: number) => {
    const nextZoom = clampZoom((zoomMode === "fit" ? 1 : zoom) + delta);
    setZoom(nextZoom);
    setZoomMode("manual");
    setPanOffset((currentOffset) =>
      clampPanOffset(currentOffset, dimensions, nextZoom, canvasRef.current)
    );
  };

  const stopPan = (event?: PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (!panState || (event && event.pointerId !== panState.pointerId)) {
      return;
    }

    if (event?.currentTarget.hasPointerCapture?.(panState.pointerId)) {
      event.currentTarget.releasePointerCapture(panState.pointerId);
    }

    panStateRef.current = null;
    setIsPanning(false);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    changeZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  };

  const handleActualSize = () => {
    setZoomMode("manual");
    setZoom(1);
    setPanOffset((currentOffset) =>
      clampPanOffset(currentOffset, dimensions, 1, canvasRef.current)
    );
  };

  const handleFit = () => {
    setZoomMode("fit");
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    stopPan();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoomMode !== "manual" || errored) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const canvas = event.currentTarget;
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      translateX: panOffset.x,
      translateY: panOffset.y,
    };
    setIsPanning(true);
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (!panState || event.pointerId !== panState.pointerId) {
      return;
    }

    const canvas = canvasRef.current ?? event.currentTarget;
    setPanOffset(
      clampPanOffset(
        {
          x: panState.translateX + (event.clientX - panState.startX),
          y: panState.translateY + (event.clientY - panState.startY),
        },
        dimensions,
        zoom,
        canvas
      )
    );
    event.preventDefault();
  };

  const imageStyle: CSSProperties | undefined =
    zoomMode === "manual" && dimensions
      ? {
          height: `${Math.max(1, Math.round(dimensions.h * zoom))}px`,
          transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)`,
          width: `${Math.max(1, Math.round(dimensions.w * zoom))}px`,
        }
      : undefined;
  const zoomLabel = zoomMode === "fit" ? t("code_editor.image_zoom_fit_level") : formatZoom(zoom);
  const zoomOutDisabled = zoomMode === "manual" && zoom <= MIN_ZOOM;
  const zoomInDisabled = zoomMode === "manual" && zoom >= MAX_ZOOM;
  const canPan = zoomMode === "manual" && !errored;
  const canvasClassName = [
    "image-preview-canvas",
    canPan ? "image-preview-canvas--pannable" : "",
    isPanning ? "image-preview-canvas--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="image-preview">
      <div
        className={canvasClassName}
        onPointerCancel={stopPan}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPan}
        onWheel={handleWheel}
        ref={canvasRef}
      >
        {errored ? (
          <EmptyState
            className="git-diff-empty"
            description={
              <p className="git-diff-empty-body">{t("code_editor.image_load_failed_body")}</p>
            }
            title={<p className="git-diff-empty-title">{t("code_editor.preview_unavailable")}</p>}
          />
        ) : (
          <img
            className={`image-preview-img${zoomMode === "manual" ? " image-preview-img--manual" : ""}`}
            src={src}
            alt={alt}
            draggable={false}
            style={imageStyle}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setErrored(true)}
          />
        )}
      </div>
      <div className="image-preview-footer">
        <div className="image-preview-meta">
          <span className="image-preview-type">{mimeToLabel(mime)}</span>
          {dimensions && (
            <span className="image-preview-dim">
              {dimensions.w} × {dimensions.h}
            </span>
          )}
          <span className="image-preview-size">{formatBytes(sizeBytes)}</span>
        </div>
        <div
          className="image-preview-controls"
          role="toolbar"
          aria-label={t("code_editor.image_zoom_controls")}
        >
          <Tooltip content={t("code_editor.image_zoom_out")}>
            <IconButton
              aria-label={t("code_editor.image_zoom_out")}
              className="image-preview-control-btn"
              disabled={zoomOutDisabled}
              icon={<ZoomOut size={14} />}
              onClick={() => changeZoom(-ZOOM_STEP)}
              size="sm"
            />
          </Tooltip>
          <span className="image-preview-zoom-level" aria-label={t("code_editor.image_zoom_level")}>
            {zoomLabel}
          </span>
          <Tooltip content={t("code_editor.image_zoom_in")}>
            <IconButton
              aria-label={t("code_editor.image_zoom_in")}
              className="image-preview-control-btn"
              disabled={zoomInDisabled}
              icon={<ZoomIn size={14} />}
              onClick={() => changeZoom(ZOOM_STEP)}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.image_zoom_fit")}>
            <IconButton
              aria-label={t("code_editor.image_zoom_fit")}
              className="image-preview-control-btn"
              disabled={zoomMode === "fit"}
              icon={<Maximize2 size={14} />}
              onClick={handleFit}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("code_editor.image_zoom_actual")}>
            <IconButton
              aria-label={t("code_editor.image_zoom_actual")}
              className="image-preview-control-btn"
              icon={<Scan size={14} />}
              onClick={handleActualSize}
              size="sm"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default ImagePreview;
