import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneDropIntent, PaneDropPlacement, PaneDropTargetType } from "./pane-drag-types";

const EDGE_RATIO = 0.22;
const EDGE_MIN = 48;
const EDGE_MAX = 96;

export interface PaneDragSourceSnapshot {
  paneId: string;
  sessionId?: string;
  title?: string;
  providerLabel?: string;
}

export interface RegisteredPane {
  type: PaneDropTargetType;
  element: HTMLElement;
}

export interface PaneDragPreviewPosition {
  x: number;
  y: number;
}

export interface PaneDragState {
  isDragging: boolean;
  source: PaneDragSourceSnapshot | null;
  hoverTargetPaneId: string | null;
  hoverPlacement: PaneDropPlacement | null;
  previewPosition: PaneDragPreviewPosition;
  previewX: number;
  previewY: number;
}

interface UsePaneDragControllerOptions {
  onDrop: (intent: PaneDropIntent) => void;
}

function createIdleState(): PaneDragState {
  return {
    isDragging: false,
    source: null,
    hoverTargetPaneId: null,
    hoverPlacement: null,
    previewPosition: { x: 0, y: 0 },
    previewX: 0,
    previewY: 0,
  };
}

function clampEdgeBand(size: number): number {
  return Math.max(EDGE_MIN, Math.min(EDGE_MAX, size * EDGE_RATIO));
}

function resolvePlacement(
  paneId: string,
  pane: RegisteredPane,
  clientX: number,
  clientY: number,
  sourcePaneId: string | undefined
): PaneDropPlacement | null {
  const rect = pane.element.getBoundingClientRect();

  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }

  if (sourcePaneId === paneId) {
    return null;
  }

  if (pane.type === "draft") {
    return "center";
  }

  const edgeX = clampEdgeBand(rect.width);
  const edgeY = clampEdgeBand(rect.height);

  if (clientX <= rect.left + edgeX) {
    return "left";
  }

  if (clientX >= rect.right - edgeX) {
    return "right";
  }

  if (clientY <= rect.top + edgeY) {
    return "top";
  }

  if (clientY >= rect.bottom - edgeY) {
    return "bottom";
  }

  return "center";
}

export function usePaneDragController({ onDrop }: UsePaneDragControllerOptions) {
  const paneRegistry = useRef(new Map<string, RegisteredPane>());
  const [state, setState] = useState<PaneDragState>(() => createIdleState());
  const onDropRef = useRef(onDrop);
  const stateRef = useRef(state);

  const setDragState = useCallback(
    (nextState: PaneDragState | ((current: PaneDragState) => PaneDragState)) => {
      const resolved = typeof nextState === "function" ? nextState(stateRef.current) : nextState;

      stateRef.current = resolved;
      setState(resolved);
    },
    []
  );

  const registerPane = useCallback((paneId: string, entry: RegisteredPane | null) => {
    if (!entry) {
      paneRegistry.current.delete(paneId);
      return;
    }

    paneRegistry.current.set(paneId, entry);
  }, []);

  const startDrag = useCallback(
    (source: PaneDragSourceSnapshot) => {
      document.body.classList.add("is-dragging-pane");
      setDragState({
        isDragging: true,
        source,
        hoverTargetPaneId: null,
        hoverPlacement: null,
        previewPosition: { x: 0, y: 0 },
        previewX: 0,
        previewY: 0,
      });
    },
    [setDragState]
  );

  const clearDrag = useCallback(() => {
    document.body.classList.remove("is-dragging-pane");
    setDragState(createIdleState());
  }, [setDragState]);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      setDragState((current) => {
        if (!current.isDragging) {
          return current;
        }

        let hoverTargetPaneId: string | null = null;
        let hoverPlacement: PaneDropPlacement | null = null;

        for (const [paneId, pane] of paneRegistry.current.entries()) {
          const placement = resolvePlacement(
            paneId,
            pane,
            event.clientX,
            event.clientY,
            current.source?.paneId
          );

          if (!placement) {
            continue;
          }

          hoverTargetPaneId = paneId;
          hoverPlacement = placement;
          break;
        }

        return {
          ...current,
          hoverTargetPaneId,
          hoverPlacement,
          previewPosition: { x: event.clientX, y: event.clientY },
          previewX: event.clientX,
          previewY: event.clientY,
        };
      });
    },
    [setDragState]
  );

  const handlePointerUp = useCallback(() => {
    const current = stateRef.current;

    if (
      current.isDragging &&
      current.source &&
      current.hoverTargetPaneId &&
      current.hoverPlacement
    ) {
      const target = paneRegistry.current.get(current.hoverTargetPaneId);

      if (target) {
        onDropRef.current({
          sourcePaneId: current.source.paneId,
          targetPaneId: current.hoverTargetPaneId,
          placement: current.hoverPlacement,
          targetType: target.type,
        });
      }
    }

    clearDrag();
  }, [clearDrag]);

  useEffect(() => {
    if (!state.isDragging) {
      return;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp, state.isDragging]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-dragging-pane");
    };
  }, []);

  return {
    clearDrag,
    handlePointerMove,
    handlePointerUp,
    registerPane,
    startDrag,
    state,
  };
}
