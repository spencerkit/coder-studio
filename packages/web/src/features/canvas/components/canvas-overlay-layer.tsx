import {
  type CanvasOverlayDocument,
  type CanvasOverlayObject,
  type CanvasPoint,
  type CanvasSceneElement,
  createEmptyCanvasOverlayDocument,
} from "@coder-studio/core";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { CanvasAnnotationCommand, CanvasAnnotationTool } from "./canvas-content";

interface CanvasOverlayLayerProps {
  editable?: boolean;
  exportMode?: boolean;
  tool?: CanvasAnnotationTool;
  overlayDocument?: CanvasOverlayDocument;
  annotationCommand?: CanvasAnnotationCommand | null;
  semanticElements?: CanvasSceneElement[];
  inspectSelectionElementId?: string | null;
  onInspectSelectionChange?: (element: CanvasSceneElement | null) => void;
  onChange?: (overlayDocument: CanvasOverlayDocument) => void;
}

interface Point {
  x: number;
  y: number;
}

interface SelectionDragState {
  objectId: string;
  pointerOffset: Point;
  originalObject: CanvasOverlayObject;
}

type HandleDragState =
  | {
      type: "rect-resize";
      objectId: string;
      originalObject: Extract<CanvasOverlayObject, { type: "rect" }>;
    }
  | {
      type: "arrow-endpoint";
      endpoint: "from" | "to";
      objectId: string;
      originalObject: Extract<CanvasOverlayObject, { type: "arrow" }>;
    };

const DEFAULT_STROKE = "#ff3366";
const DEFAULT_STROKE_WIDTH = 3;
const DEFAULT_FONT_SIZE = 16;
const TEXT_HITBOX_WIDTH = 180;
const TEXT_HITBOX_HEIGHT = 32;
const MIN_SELECTABLE_STROKE_DISTANCE = 10;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function clampRect(from: Point, to: Point) {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

function pointToScene(
  element: HTMLDivElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function isPointInsideRect(
  point: Point,
  object: Extract<CanvasOverlayObject, { type: "rect" }>
): boolean {
  return (
    point.x >= object.x &&
    point.x <= object.x + object.width &&
    point.y >= object.y &&
    point.y <= object.y + object.height
  );
}

function isPointInsideText(
  point: Point,
  object: Extract<CanvasOverlayObject, { type: "text" }>
): boolean {
  return (
    point.x >= object.x &&
    point.x <= object.x + TEXT_HITBOX_WIDTH &&
    point.y <= object.y &&
    point.y >= object.y - TEXT_HITBOX_HEIGHT
  );
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy))
  );
  const projectionX = from.x + t * dx;
  const projectionY = from.y + t * dy;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function isPointNearArrow(
  point: Point,
  object: Extract<CanvasOverlayObject, { type: "arrow" }>
): boolean {
  return distanceToSegment(point, object.from, object.to) <= MIN_SELECTABLE_STROKE_DISTANCE;
}

function isPointNearStroke(
  point: Point,
  object: Extract<CanvasOverlayObject, { type: "stroke" }>
): boolean {
  if (object.points.length === 1) {
    const [strokePoint] = object.points;
    if (!strokePoint) {
      return false;
    }

    return (
      Math.hypot(point.x - strokePoint.x, point.y - strokePoint.y) <= MIN_SELECTABLE_STROKE_DISTANCE
    );
  }

  for (let index = 1; index < object.points.length; index += 1) {
    const from = object.points[index - 1];
    const to = object.points[index];

    if (!from || !to) {
      continue;
    }

    if (distanceToSegment(point, from, to) <= MIN_SELECTABLE_STROKE_DISTANCE) {
      return true;
    }
  }

  return false;
}

function hitTestObject(object: CanvasOverlayObject, point: Point): boolean {
  switch (object.type) {
    case "rect":
      return isPointInsideRect(point, object);
    case "text":
      return isPointInsideText(point, object);
    case "arrow":
      return isPointNearArrow(point, object);
    case "stroke":
      return isPointNearStroke(point, object);
  }
}

function isPointInsideSceneRect(point: Point, rect: CanvasSceneElement["rect"]): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function findSemanticElementAtPoint(
  elements: CanvasSceneElement[],
  point: Point
): CanvasSceneElement | null {
  const hits = elements.filter((element) => isPointInsideSceneRect(point, element.rect));

  if (hits.length === 0) {
    return null;
  }

  return hits.reduce((best, candidate) => {
    const bestArea = best.rect.width * best.rect.height;
    const candidateArea = candidate.rect.width * candidate.rect.height;

    if (candidateArea < bestArea) {
      return candidate;
    }

    return best;
  });
}

function findObjectAtPoint(
  objects: CanvasOverlayObject[],
  point: Point
): CanvasOverlayObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (!object) {
      continue;
    }

    if (hitTestObject(object, point)) {
      return object;
    }
  }

  return null;
}

function moveObject(
  object: CanvasOverlayObject,
  point: Point,
  pointerOffset: Point
): CanvasOverlayObject {
  switch (object.type) {
    case "rect":
      return {
        ...object,
        x: point.x - pointerOffset.x,
        y: point.y - pointerOffset.y,
      };
    case "text":
      return {
        ...object,
        x: point.x - pointerOffset.x,
        y: point.y - pointerOffset.y,
      };
    case "arrow": {
      const deltaX = point.x - pointerOffset.x - object.from.x;
      const deltaY = point.y - pointerOffset.y - object.from.y;
      return {
        ...object,
        from: {
          x: object.from.x + deltaX,
          y: object.from.y + deltaY,
        },
        to: {
          x: object.to.x + deltaX,
          y: object.to.y + deltaY,
        },
      };
    }
    case "stroke": {
      const firstPoint = object.points[0] ?? { x: 0, y: 0 };
      const deltaX = point.x - pointerOffset.x - firstPoint.x;
      const deltaY = point.y - pointerOffset.y - firstPoint.y;
      return {
        ...object,
        points: object.points.map((strokePoint: CanvasPoint) => ({
          x: strokePoint.x + deltaX,
          y: strokePoint.y + deltaY,
        })),
      };
    }
  }
}

function resizeRect(
  object: Extract<CanvasOverlayObject, { type: "rect" }>,
  point: Point
): Extract<CanvasOverlayObject, { type: "rect" }> {
  return {
    ...object,
    width: Math.max(0, point.x - object.x),
    height: Math.max(0, point.y - object.y),
  };
}

function moveArrowEndpoint(
  object: Extract<CanvasOverlayObject, { type: "arrow" }>,
  endpoint: "from" | "to",
  point: Point
): Extract<CanvasOverlayObject, { type: "arrow" }> {
  return {
    ...object,
    [endpoint]: point,
  };
}

function renderSelectionOutline(object: CanvasOverlayObject) {
  switch (object.type) {
    case "stroke":
      return (
        <polyline
          key={`${object.id}__selection`}
          className="canvas-overlay-layer__selection"
          fill="none"
          points={object.points.map((point) => `${point.x},${point.y}`).join(" ")}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={object.strokeWidth + 8}
        />
      );
    case "rect":
      return (
        <rect
          key={`${object.id}__selection`}
          className="canvas-overlay-layer__selection"
          fill="none"
          height={object.height + 8}
          strokeWidth={2}
          width={object.width + 8}
          x={object.x - 4}
          y={object.y - 4}
        />
      );
    case "arrow":
      return (
        <line
          key={`${object.id}__selection`}
          className="canvas-overlay-layer__selection"
          strokeLinecap="round"
          strokeWidth={object.strokeWidth + 8}
          x1={object.from.x}
          x2={object.to.x}
          y1={object.from.y}
          y2={object.to.y}
        />
      );
    case "text":
      return (
        <rect
          key={`${object.id}__selection`}
          className="canvas-overlay-layer__selection"
          fill="none"
          height={TEXT_HITBOX_HEIGHT}
          strokeWidth={2}
          width={TEXT_HITBOX_WIDTH}
          x={object.x - 4}
          y={object.y - TEXT_HITBOX_HEIGHT}
        />
      );
  }
}

function renderSelectionHandles(
  object: CanvasOverlayObject,
  onHandlePointerDown: (event: ReactPointerEvent<SVGElement>, handleDrag: HandleDragState) => void
) {
  switch (object.type) {
    case "rect":
      return (
        <rect
          key={`${object.id}__resize`}
          className="canvas-overlay-layer__handle canvas-overlay-layer__handle--rect-resize"
          height={12}
          onPointerDown={(event) =>
            onHandlePointerDown(event, {
              type: "rect-resize",
              objectId: object.id,
              originalObject: object,
            })
          }
          width={12}
          x={object.x + object.width - 6}
          y={object.y + object.height - 6}
        />
      );
    case "arrow":
      return (
        <g key={`${object.id}__handles`}>
          <circle
            className="canvas-overlay-layer__handle canvas-overlay-layer__handle--arrow-from"
            cx={object.from.x}
            cy={object.from.y}
            onPointerDown={(event) =>
              onHandlePointerDown(event, {
                type: "arrow-endpoint",
                endpoint: "from",
                objectId: object.id,
                originalObject: object,
              })
            }
            r={6}
          />
          <circle
            className="canvas-overlay-layer__handle canvas-overlay-layer__handle--arrow-to"
            cx={object.to.x}
            cy={object.to.y}
            onPointerDown={(event) =>
              onHandlePointerDown(event, {
                type: "arrow-endpoint",
                endpoint: "to",
                objectId: object.id,
                originalObject: object,
              })
            }
            r={6}
          />
        </g>
      );
    case "stroke":
    case "text":
      return null;
  }
}

function renderObject(object: CanvasOverlayObject) {
  switch (object.type) {
    case "stroke":
      return (
        <polyline
          key={object.id}
          fill="none"
          points={object.points.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={object.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={object.strokeWidth}
        />
      );
    case "rect":
      return (
        <rect
          key={object.id}
          fill="none"
          height={object.height}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          width={object.width}
          x={object.x}
          y={object.y}
        />
      );
    case "arrow":
      return (
        <g key={object.id}>
          <line
            stroke={object.color}
            strokeLinecap="round"
            strokeWidth={object.strokeWidth}
            x1={object.from.x}
            x2={object.to.x}
            y1={object.from.y}
            y2={object.to.y}
          />
          <polygon
            fill={object.color}
            points={`${object.to.x},${object.to.y} ${object.to.x - 10},${object.to.y - 5} ${object.to.x - 10},${object.to.y + 5}`}
          />
        </g>
      );
    case "text":
      return (
        <text
          key={object.id}
          fill={object.color}
          fontSize={object.fontSize}
          x={object.x}
          y={object.y}
        >
          {object.text}
        </text>
      );
  }
}

export function CanvasOverlayLayer({
  editable = false,
  exportMode = false,
  tool = "select",
  overlayDocument,
  annotationCommand = null,
  semanticElements = [],
  inspectSelectionElementId = null,
  onInspectSelectionChange,
  onChange,
}: CanvasOverlayLayerProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<CanvasOverlayDocument>(
    overlayDocument ?? createEmptyCanvasOverlayDocument()
  );
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [draftObject, setDraftObject] = useState<CanvasOverlayObject | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDragState | null>(null);
  const [handleDrag, setHandleDrag] = useState<HandleDragState | null>(null);
  const handledAnnotationCommandRef = useRef<CanvasAnnotationCommand | null>(null);

  useEffect(() => {
    setDraft(overlayDocument ?? createEmptyCanvasOverlayDocument());
    setSelectedObjectId(null);
    setDraftObject(null);
    setDragStart(null);
    setSelectionDrag(null);
    setHandleDrag(null);
    setTextDraft(null);
  }, [overlayDocument]);

  useEffect(() => {
    if (!annotationCommand) {
      return;
    }

    if (handledAnnotationCommandRef.current === annotationCommand) {
      return;
    }

    handledAnnotationCommandRef.current = annotationCommand;

    if (annotationCommand.type === "delete-selected") {
      if (!selectedObjectId) {
        return;
      }

      const nextDocument = {
        ...draft,
        objects: draft.objects.filter((object) => object.id !== selectedObjectId),
      };
      setSelectedObjectId(null);
      setSelectionDrag(null);
      setHandleDrag(null);
      setDraft(nextDocument);
      onChange?.(nextDocument);
      return;
    }

    if (annotationCommand.type === "clear-all") {
      if (draft.objects.length === 0) {
        return;
      }

      const nextDocument = createEmptyCanvasOverlayDocument();
      setSelectedObjectId(null);
      setSelectionDrag(null);
      setHandleDrag(null);
      setDraft(nextDocument);
      onChange?.(nextDocument);
    }
  }, [annotationCommand, draft, onChange, selectedObjectId]);

  useEffect(() => {
    if (tool !== "select" && selectedObjectId) {
      setSelectedObjectId(null);
      setSelectionDrag(null);
      setHandleDrag(null);
    }
  }, [selectedObjectId, tool]);

  const commitDocument = (nextDocument: CanvasOverlayDocument) => {
    setDraft(nextDocument);
    onChange?.(nextDocument);
  };

  const handleSelectionHandlePointerDown = (
    event: ReactPointerEvent<SVGElement>,
    nextHandleDrag: HandleDragState
  ) => {
    if (!editable || tool !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDraftObject(null);
    setDragStart(null);
    setTextDraft(null);
    setSelectionDrag(null);
    setSelectedObjectId(nextHandleDrag.objectId);
    setHandleDrag(nextHandleDrag);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((!editable && tool !== "inspect") || event.button !== 0) {
      return;
    }

    const scene = sceneRef.current;
    if (!scene) {
      return;
    }

    const point = pointToScene(scene, event.clientX, event.clientY);

    if (tool === "inspect") {
      onInspectSelectionChange?.(findSemanticElementAtPoint(semanticElements, point));
      return;
    }

    if (tool === "select") {
      const hitObject = findObjectAtPoint(draft.objects, point);
      setDraftObject(null);
      setDragStart(null);
      setTextDraft(null);

      if (!hitObject) {
        setSelectedObjectId(null);
        setSelectionDrag(null);
        setHandleDrag(null);
        return;
      }

      setSelectedObjectId(hitObject.id);
      setHandleDrag(null);

      if (hitObject.type === "rect" || hitObject.type === "text") {
        setSelectionDrag({
          objectId: hitObject.id,
          pointerOffset: {
            x: point.x - hitObject.x,
            y: point.y - hitObject.y,
          },
          originalObject: hitObject,
        });
        return;
      }

      if (hitObject.type === "arrow") {
        setSelectionDrag({
          objectId: hitObject.id,
          pointerOffset: {
            x: point.x - hitObject.from.x,
            y: point.y - hitObject.from.y,
          },
          originalObject: hitObject,
        });
        return;
      }

      if (hitObject.type === "stroke") {
        const firstPoint = hitObject.points[0] ?? point;
        setSelectionDrag({
          objectId: hitObject.id,
          pointerOffset: {
            x: point.x - firstPoint.x,
            y: point.y - firstPoint.y,
          },
          originalObject: hitObject,
        });
      }

      return;
    }

    setSelectedObjectId(null);
    setSelectionDrag(null);
    setHandleDrag(null);

    if (tool === "text") {
      setTextDraft({ x: point.x, y: point.y, value: "" });
      return;
    }

    if (tool === "pen") {
      setDraftObject({
        id: makeId("stroke"),
        type: "stroke",
        color: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        points: [point],
      });
      setDragStart(point);
      return;
    }

    if (tool === "arrow") {
      setDraftObject({
        id: makeId("arrow"),
        type: "arrow",
        color: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        from: point,
        to: point,
      });
      setDragStart(point);
      return;
    }

    if (tool === "rect") {
      setDraftObject({
        id: makeId("rect"),
        type: "rect",
        color: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      });
      setDragStart(point);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable) {
      return;
    }

    const scene = sceneRef.current;
    if (!scene) {
      return;
    }

    const point = pointToScene(scene, event.clientX, event.clientY);

    if (tool === "select" && handleDrag) {
      const nextDocument = {
        ...draft,
        objects: draft.objects.map((object) => {
          if (object.id !== handleDrag.objectId) {
            return object;
          }

          if (handleDrag.type === "rect-resize" && object.type === "rect") {
            return resizeRect(handleDrag.originalObject, point);
          }

          if (handleDrag.type === "arrow-endpoint" && object.type === "arrow") {
            return moveArrowEndpoint(handleDrag.originalObject, handleDrag.endpoint, point);
          }

          return object;
        }),
      };
      setDraft(nextDocument);
      return;
    }

    if (tool === "select" && selectionDrag) {
      const nextDocument = {
        ...draft,
        objects: draft.objects.map((object) =>
          object.id === selectionDrag.objectId
            ? moveObject(selectionDrag.originalObject, point, selectionDrag.pointerOffset)
            : object
        ),
      };
      setDraft(nextDocument);
      return;
    }

    if (!draftObject || !dragStart) {
      return;
    }

    if (draftObject.type === "stroke") {
      setDraftObject({
        ...draftObject,
        points: [...draftObject.points, point],
      });
      return;
    }

    if (draftObject.type === "arrow") {
      setDraftObject({
        ...draftObject,
        to: point,
      });
      return;
    }

    if (draftObject.type === "rect") {
      const nextRect = clampRect(dragStart, point);
      setDraftObject({
        ...draftObject,
        ...nextRect,
      });
    }
  };

  const handlePointerUp = () => {
    if (!editable) {
      return;
    }

    if (tool === "select" && handleDrag) {
      const currentObject = draft.objects.find((object) => object.id === handleDrag.objectId);
      setHandleDrag(null);
      if (!currentObject) {
        return;
      }

      const changed = JSON.stringify(currentObject) !== JSON.stringify(handleDrag.originalObject);
      if (changed) {
        onChange?.(draft);
      }
      return;
    }

    if (tool === "select" && selectionDrag) {
      const currentObject = draft.objects.find((object) => object.id === selectionDrag.objectId);
      setSelectionDrag(null);
      if (!currentObject) {
        return;
      }

      const changed =
        JSON.stringify(currentObject) !== JSON.stringify(selectionDrag.originalObject);
      if (changed) {
        onChange?.(draft);
      }
      return;
    }

    if (!draftObject) {
      return;
    }

    commitDocument({
      ...draft,
      objects: [...draft.objects, draftObject],
    });
    setDraftObject(null);
    setDragStart(null);
  };

  const handleTextBlur = () => {
    if (!textDraft) {
      return;
    }

    const trimmed = textDraft.value.trim();
    setTextDraft(null);
    if (!trimmed) {
      return;
    }

    commitDocument({
      ...draft,
      objects: [
        ...draft.objects,
        {
          id: makeId("text"),
          type: "text",
          color: "#0f172a",
          fontSize: DEFAULT_FONT_SIZE,
          x: textDraft.x,
          y: textDraft.y,
          text: trimmed,
        },
      ],
    });
  };

  const objects = draftObject ? [...draft.objects, draftObject] : draft.objects;
  const selectedObject =
    selectedObjectId === null
      ? null
      : (objects.find((object) => object.id === selectedObjectId) ?? null);
  const inspectSelection =
    inspectSelectionElementId === null
      ? null
      : (semanticElements.find((element) => element.id === inspectSelectionElementId) ?? null);
  const interactive =
    !exportMode &&
    (editable || tool === "inspect" || (tool === "select" && draft.objects.length > 0));

  return (
    <div
      ref={sceneRef}
      className={`canvas-overlay-layer__scene${
        interactive ? " canvas-overlay-layer__scene--editable" : ""
      }${tool === "select" ? " canvas-overlay-layer__scene--selecting" : ""}${
        tool === "inspect" ? " canvas-overlay-layer__scene--inspect" : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="canvas-overlay-layer__svg" preserveAspectRatio="none">
        {!exportMode && inspectSelection ? (
          <rect
            className="canvas-overlay-layer__inspect-selection"
            fill="none"
            height={inspectSelection.rect.height}
            width={inspectSelection.rect.width}
            x={inspectSelection.rect.x}
            y={inspectSelection.rect.y}
          />
        ) : null}
        {!exportMode && selectedObject ? renderSelectionOutline(selectedObject) : null}
        {objects.map((object) => renderObject(object))}
        {!exportMode && editable && tool === "select" && selectedObject
          ? renderSelectionHandles(selectedObject, handleSelectionHandlePointerDown)
          : null}
      </svg>
      {!exportMode && textDraft ? (
        <textarea
          autoFocus
          className="canvas-overlay-layer__textarea"
          onBlur={handleTextBlur}
          onChange={(event) =>
            setTextDraft((current) =>
              current
                ? {
                    ...current,
                    value: event.target.value,
                  }
                : current
            )
          }
          style={{
            left: `${textDraft.x}px`,
            top: `${textDraft.y}px`,
          }}
          value={textDraft.value}
        />
      ) : null}
    </div>
  );
}
