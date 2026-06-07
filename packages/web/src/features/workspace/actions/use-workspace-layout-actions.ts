import { useAtom } from "jotai";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";
import { bottomPanelHeightAtomFamily, leftPanelWidthAtomFamily } from "../atoms";

const MIN_LEFT_WIDTH = 220;
const MIN_BOTTOM_HEIGHT = 120;

function resolvePanelSize(measuredSize: number, inlineSize: string, fallbackSize: number) {
  if (measuredSize > 0) {
    return measuredSize;
  }

  const parsedInlineSize = Number.parseFloat(inlineSize);
  if (Number.isFinite(parsedInlineSize) && parsedInlineSize > 0) {
    return parsedInlineSize;
  }

  return fallbackSize;
}

function releaseCapturedPointer(element: HTMLElement | null, pointerId: number | null) {
  if (pointerId === null || !element?.hasPointerCapture?.(pointerId)) {
    return;
  }

  element.releasePointerCapture?.(pointerId);
}

export function useWorkspaceLayoutActions(workspaceId: string) {
  const [storedLeftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtomFamily(workspaceId));
  const [storedBottomPanelHeight, setBottomPanelHeight] = useAtom(
    bottomPanelHeightAtomFamily(workspaceId)
  );

  const leftMouseDown = useRef(false);
  const leftPanelRef = useRef<HTMLElement | null>(null);
  const leftStartX = useRef(0);
  const leftStartWidth = useRef(0);
  const leftCurrentWidth = useRef(storedLeftPanelWidth);
  const leftPointerId = useRef<number | null>(null);
  const leftResizeHandleRef = useRef<HTMLElement | null>(null);
  const leftResizeCleanupRef = useRef<(() => void) | null>(null);
  const bottomPanelRef = useRef<HTMLDivElement | null>(null);
  const bottomPointerId = useRef<number | null>(null);
  const bottomResizeHandleRef = useRef<HTMLElement | null>(null);
  const bottomResizeCleanupRef = useRef<(() => void) | null>(null);

  const syncBodyResizeClass = useCallback(() => {
    document.body.classList.toggle(
      "is-resizing-panels",
      leftMouseDown.current || bottomMouseDown.current
    );
  }, []);

  const clearLeftResizeSession = useCallback(() => {
    const cleanup = leftResizeCleanupRef.current;
    leftResizeCleanupRef.current = null;
    cleanup?.();
    releaseCapturedPointer(leftResizeHandleRef.current, leftPointerId.current);
    leftResizeHandleRef.current = null;
    leftPointerId.current = null;
  }, []);

  const finishLeftResize = useCallback(
    (commit: boolean) => {
      if (!leftMouseDown.current) {
        clearLeftResizeSession();
        syncBodyResizeClass();
        return;
      }

      leftMouseDown.current = false;
      if (commit) {
        setLeftPanelWidth(leftCurrentWidth.current);
      }
      clearLeftResizeSession();
      syncBodyResizeClass();
    },
    [clearLeftResizeSession, setLeftPanelWidth, syncBodyResizeClass]
  );

  const handleLeftPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.preventDefault();
      finishLeftResize(true);

      leftMouseDown.current = true;
      leftPointerId.current = event.pointerId;
      leftResizeHandleRef.current = event.currentTarget;
      leftStartX.current = event.clientX;
      leftStartWidth.current = resolvePanelSize(
        leftPanelRef.current?.offsetWidth ?? 0,
        leftPanelRef.current?.style.width ?? "",
        storedLeftPanelWidth
      );
      leftCurrentWidth.current = leftStartWidth.current;
      leftResizeHandleRef.current.setPointerCapture?.(event.pointerId);
      syncBodyResizeClass();

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!leftMouseDown.current || moveEvent.pointerId !== leftPointerId.current) {
          return;
        }

        const dx = moveEvent.clientX - leftStartX.current;
        const nextWidth = Math.max(MIN_LEFT_WIDTH, leftStartWidth.current + dx);
        leftCurrentWidth.current = nextWidth;
        if (leftPanelRef.current) {
          leftPanelRef.current.style.width = `${nextWidth}px`;
        }
      };

      const onPointerFinish = (finishEvent?: PointerEvent) => {
        if (finishEvent && finishEvent.pointerId !== leftPointerId.current) {
          return;
        }

        finishLeftResize(true);
      };

      const onBlur = () => {
        finishLeftResize(true);
      };

      const onLostPointerCapture = () => {
        finishLeftResize(true);
      };

      leftResizeCleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerFinish);
        window.removeEventListener("pointercancel", onPointerFinish);
        window.removeEventListener("blur", onBlur);
        leftResizeHandleRef.current?.removeEventListener(
          "lostpointercapture",
          onLostPointerCapture
        );
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerFinish);
      window.addEventListener("pointercancel", onPointerFinish);
      window.addEventListener("blur", onBlur);
      leftResizeHandleRef.current.addEventListener("lostpointercapture", onLostPointerCapture);
    },
    [finishLeftResize, storedLeftPanelWidth, syncBodyResizeClass]
  );

  const bottomMouseDown = useRef(false);
  const bottomStartY = useRef(0);
  const bottomStartHeight = useRef(0);
  const bottomCurrentHeight = useRef(storedBottomPanelHeight);

  const clearBottomResizeSession = useCallback(() => {
    const cleanup = bottomResizeCleanupRef.current;
    bottomResizeCleanupRef.current = null;
    cleanup?.();
    releaseCapturedPointer(bottomResizeHandleRef.current, bottomPointerId.current);
    bottomResizeHandleRef.current = null;
    bottomPointerId.current = null;
  }, []);

  const finishBottomResize = useCallback(
    (commit: boolean) => {
      if (!bottomMouseDown.current) {
        clearBottomResizeSession();
        syncBodyResizeClass();
        return;
      }

      bottomMouseDown.current = false;
      if (commit) {
        setBottomPanelHeight(bottomCurrentHeight.current);
      }
      clearBottomResizeSession();
      syncBodyResizeClass();
    },
    [clearBottomResizeSession, setBottomPanelHeight, syncBodyResizeClass]
  );

  const handleBottomPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.preventDefault();
      finishBottomResize(true);

      bottomMouseDown.current = true;
      bottomPointerId.current = event.pointerId;
      bottomResizeHandleRef.current = event.currentTarget;
      bottomStartY.current = event.clientY;
      bottomStartHeight.current = resolvePanelSize(
        bottomPanelRef.current?.offsetHeight ?? 0,
        bottomPanelRef.current?.style.height ?? "",
        storedBottomPanelHeight
      );
      bottomCurrentHeight.current = bottomStartHeight.current;
      bottomResizeHandleRef.current.setPointerCapture?.(event.pointerId);
      syncBodyResizeClass();

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!bottomMouseDown.current || moveEvent.pointerId !== bottomPointerId.current) {
          return;
        }

        const dy = bottomStartY.current - moveEvent.clientY;
        const nextHeight = Math.max(MIN_BOTTOM_HEIGHT, bottomStartHeight.current + dy);
        bottomCurrentHeight.current = nextHeight;
        if (bottomPanelRef.current) {
          bottomPanelRef.current.style.height = `${nextHeight}px`;
        }
      };

      const onPointerFinish = (finishEvent?: PointerEvent) => {
        if (finishEvent && finishEvent.pointerId !== bottomPointerId.current) {
          return;
        }

        finishBottomResize(true);
      };

      const onBlur = () => {
        finishBottomResize(true);
      };

      const onLostPointerCapture = () => {
        finishBottomResize(true);
      };

      bottomResizeCleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerFinish);
        window.removeEventListener("pointercancel", onPointerFinish);
        window.removeEventListener("blur", onBlur);
        bottomResizeHandleRef.current?.removeEventListener(
          "lostpointercapture",
          onLostPointerCapture
        );
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerFinish);
      window.addEventListener("pointercancel", onPointerFinish);
      window.addEventListener("blur", onBlur);
      bottomResizeHandleRef.current.addEventListener("lostpointercapture", onLostPointerCapture);
    },
    [finishBottomResize, storedBottomPanelHeight, syncBodyResizeClass]
  );

  useEffect(() => {
    return () => {
      leftMouseDown.current = false;
      bottomMouseDown.current = false;
      clearLeftResizeSession();
      clearBottomResizeSession();
      document.body.classList.remove("is-resizing-panels");
    };
  }, [clearBottomResizeSession, clearLeftResizeSession]);

  return {
    bottomPanelHeight: storedBottomPanelHeight,
    bottomPanelRef,
    handleBottomPointerDown,
    handleLeftPointerDown,
    leftPanelRef,
    leftPanelWidth: storedLeftPanelWidth,
  };
}
