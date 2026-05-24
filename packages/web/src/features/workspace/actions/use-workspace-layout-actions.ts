import { useAtom } from "jotai";
import { type MouseEvent as ReactMouseEvent, useCallback, useRef } from "react";
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
  const bottomPanelRef = useRef<HTMLDivElement | null>(null);

  const handleLeftMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      leftMouseDown.current = true;
      leftStartX.current = event.clientX;
      leftStartWidth.current = resolvePanelSize(
        leftPanelRef.current?.offsetWidth ?? 0,
        leftPanelRef.current?.style.width ?? "",
        storedLeftPanelWidth
      );
      leftCurrentWidth.current = leftStartWidth.current;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!leftMouseDown.current) {
          return;
        }

        const dx = moveEvent.clientX - leftStartX.current;
        const nextWidth = Math.max(MIN_LEFT_WIDTH, leftStartWidth.current + dx);
        leftCurrentWidth.current = nextWidth;
        if (leftPanelRef.current) {
          leftPanelRef.current.style.width = `${nextWidth}px`;
        }
      };

      const onMouseUp = () => {
        leftMouseDown.current = false;
        document.body.classList.remove("is-resizing-panels");
        setLeftPanelWidth(leftCurrentWidth.current);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [setLeftPanelWidth, storedLeftPanelWidth]
  );

  const bottomMouseDown = useRef(false);
  const bottomStartY = useRef(0);
  const bottomStartHeight = useRef(0);
  const bottomCurrentHeight = useRef(storedBottomPanelHeight);

  const handleBottomMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      bottomMouseDown.current = true;
      bottomStartY.current = event.clientY;
      bottomStartHeight.current = resolvePanelSize(
        bottomPanelRef.current?.offsetHeight ?? 0,
        bottomPanelRef.current?.style.height ?? "",
        storedBottomPanelHeight
      );
      bottomCurrentHeight.current = bottomStartHeight.current;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!bottomMouseDown.current) {
          return;
        }

        const dy = bottomStartY.current - moveEvent.clientY;
        const nextHeight = Math.max(MIN_BOTTOM_HEIGHT, bottomStartHeight.current + dy);
        bottomCurrentHeight.current = nextHeight;
        if (bottomPanelRef.current) {
          bottomPanelRef.current.style.height = `${nextHeight}px`;
        }
      };

      const onMouseUp = () => {
        bottomMouseDown.current = false;
        document.body.classList.remove("is-resizing-panels");
        setBottomPanelHeight(bottomCurrentHeight.current);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [setBottomPanelHeight, storedBottomPanelHeight]
  );

  return {
    bottomPanelHeight: storedBottomPanelHeight,
    bottomPanelRef,
    handleBottomMouseDown,
    handleLeftMouseDown,
    leftPanelRef,
    leftPanelWidth: storedLeftPanelWidth,
  };
}
