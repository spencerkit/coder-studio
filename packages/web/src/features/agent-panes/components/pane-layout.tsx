/**
 * Pane Layout Component
 *
 * Split container for agent panels.
 * Supports horizontal and vertical splits.
 */

import type { FC, ReactNode } from 'react';
import { useState, useRef, useCallback } from 'react';

interface PaneLayoutProps {
  direction: 'horizontal' | 'vertical';
  ratio: number; // 0-1, ratio of first child
  children: ReactNode;
}

/**
 * Pane Layout
 *
 * PRD §8.3.2:
 *   - Draggable divider (8px width)
 *   - Horizontal/vertical direction
 *   - Resizable by dragging
 */
export const PaneLayout: FC<PaneLayoutProps> = ({ direction, ratio, children }) => {
  const [currentRatio, setCurrentRatio] = useState(ratio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.classList.add('is-resizing-panels');
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const total = direction === 'horizontal' ? rect.width : rect.height;
    const position = direction === 'horizontal' ? e.clientX - rect.left : e.clientY - rect.top;
    const newRatio = Math.max(0.1, Math.min(0.9, position / total));

    setCurrentRatio(newRatio);
  }, [direction]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.classList.remove('is-resizing-panels');
  }, []);

  // Setup event listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const childArray = Array.isArray(children) ? children : [children];
  const [first, second] = childArray;

  const style = direction === 'horizontal'
    ? { gridTemplateColumns: `${currentRatio * 100}% 8px ${(1 - currentRatio) * 100}%` }
    : { gridTemplateRows: `${currentRatio * 100}% 8px ${(1 - currentRatio) * 100}%` };

  return (
    <div ref={containerRef} className={`pane-layout pane-layout-${direction}`} style={style}>
      <div className="pane-layout-child">{first}</div>
      <div
        className="pane-layout-divider"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      />
      <div className="pane-layout-child">{second}</div>
    </div>
  );
};

import { useEffect } from 'react';

export default PaneLayout;
