/**
 * Pane Layout Component
 *
 * Split container for agent panels.
 * Supports horizontal and vertical splits.
 */

import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface PaneLayoutProps {
  splitId: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: ReactNode;
  onRatioCommit?: (ratio: number) => void;
}

/**
 * Pane Layout
 *
 * PRD §8.3.2:
 *   - Draggable divider (8px width)
 *   - Horizontal/vertical direction
 *   - Resizable by dragging
 */
export const PaneLayout: FC<PaneLayoutProps> = ({
  splitId,
  direction,
  ratio,
  children,
  onRatioCommit,
}) => {
  const [currentRatio, setCurrentRatio] = useState(ratio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const pendingRatio = useRef(ratio);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    pendingRatio.current = currentRatio;
    document.body.classList.add("is-resizing-panels");
  }, [currentRatio]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const total = direction === "horizontal" ? rect.width : rect.height;
      const position =
        direction === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
      const nextRatio = Math.max(0.1, Math.min(0.9, position / total));

      setCurrentRatio(nextRatio);
      pendingRatio.current = nextRatio;
    },
    [direction]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) {
      return;
    }

    isDragging.current = false;
    document.body.classList.remove("is-resizing-panels");
    onRatioCommit?.(pendingRatio.current);
  }, [onRatioCommit]);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    setCurrentRatio(ratio);
    pendingRatio.current = ratio;
  }, [ratio, splitId]);

  const childArray = Array.isArray(children) ? children : [children];
  const [first, second] = childArray;

  const style =
    direction === "horizontal"
      ? { gridTemplateColumns: `${currentRatio * 100}% 0px ${(1 - currentRatio) * 100}%` }
      : { gridTemplateRows: `${currentRatio * 100}% 0px ${(1 - currentRatio) * 100}%` };
  const dividerClassName =
    direction === "horizontal"
      ? "pane-layout-divider pane-layout-horizontal-divider"
      : "pane-layout-divider pane-layout-vertical-divider";

  return (
    <div
      ref={containerRef}
      className={`pane-layout pane-layout-${direction}`}
      style={{ display: "grid", ...style }}
    >
      <div className="pane-layout-child">{first}</div>
      <div
        className={dividerClassName}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      />
      <div className="pane-layout-child">{second}</div>
    </div>
  );
};

export default PaneLayout;
