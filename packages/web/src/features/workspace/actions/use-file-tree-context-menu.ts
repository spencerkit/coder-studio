import type { FileNode } from "@coder-studio/core";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const LONG_PRESS_MS = 450;
export const MOVE_TOLERANCE_PX = 10;

export interface FileContextTarget {
  node: FileNode;
  surface: "tree" | "search" | "mobile";
  triggerElement: HTMLElement | null;
}

interface AnchorPoint {
  x: number;
  y: number;
}

interface LongPressState {
  pointerId: number;
  startPoint: AnchorPoint;
  timer: number;
  target: FileContextTarget;
}

function movedPastTolerance(startPoint: AnchorPoint, nextPoint: AnchorPoint) {
  return (
    Math.abs(nextPoint.x - startPoint.x) > MOVE_TOLERANCE_PX ||
    Math.abs(nextPoint.y - startPoint.y) > MOVE_TOLERANCE_PX
  );
}

export function useFileTreeContextMenu() {
  const [contextTarget, setContextTarget] = useState<FileContextTarget | null>(null);
  const [desktopAnchorPoint, setDesktopAnchorPoint] = useState<AnchorPoint | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const suppressNextClickRef = useRef(false);
  const longPressRef = useRef<LongPressState | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearLongPress();
    setDesktopAnchorPoint(null);
    setMobileOpen(false);
  }, [clearLongPress]);

  const openDesktopMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, target: FileContextTarget) => {
      event.preventDefault();
      clearLongPress();
      setContextTarget(target);
      setDesktopAnchorPoint({ x: event.clientX, y: event.clientY });
      setMobileOpen(false);
    },
    [clearLongPress]
  );

  const beginLongPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>, target: FileContextTarget) => {
      if (event.pointerType === "mouse") {
        return;
      }

      clearLongPress();
      longPressRef.current = {
        pointerId: event.pointerId,
        startPoint: { x: event.clientX, y: event.clientY },
        timer: window.setTimeout(() => {
          setContextTarget(target);
          setDesktopAnchorPoint(null);
          setMobileOpen(true);
          suppressNextClickRef.current = true;
          longPressRef.current = null;
        }, LONG_PRESS_MS),
        target,
      };
    },
    [clearLongPress]
  );

  const updateLongPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }

      if (movedPastTolerance(current.startPoint, { x: event.clientX, y: event.clientY })) {
        clearLongPress();
      }
    },
    [clearLongPress]
  );

  const cancelLongPress = useCallback(
    (pointerId?: number) => {
      if (pointerId !== undefined && longPressRef.current?.pointerId !== pointerId) {
        return;
      }

      clearLongPress();
    },
    [clearLongPress]
  );

  const consumeSuppressedClick = useCallback(() => {
    const suppressed = suppressNextClickRef.current;
    suppressNextClickRef.current = false;
    return suppressed;
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const isOpen = useMemo(
    () => desktopAnchorPoint !== null || mobileOpen,
    [desktopAnchorPoint, mobileOpen]
  );

  return {
    contextTarget,
    desktopAnchorPoint,
    mobileOpen,
    isOpen,
    closeMenu,
    openDesktopMenu,
    beginLongPress,
    updateLongPress,
    cancelLongPress,
    consumeSuppressedClick,
  };
}
