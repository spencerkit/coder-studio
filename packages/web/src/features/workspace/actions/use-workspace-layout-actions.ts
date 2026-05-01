import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useAtom } from 'jotai';
import { bottomPanelHeightAtom, leftPanelWidthAtom } from '../atoms/layout';

const DEFAULT_LEFT_WIDTH = 280;
const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_WIDTH = 480;
const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_HEIGHT = 400;

export function useWorkspaceLayoutActions() {
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);

  useEffect(() => {
    if (leftPanelWidth === 200 || leftPanelWidth === 220 || leftPanelWidth === 264) {
      setLeftPanelWidth(DEFAULT_LEFT_WIDTH);
    }
  }, [leftPanelWidth, setLeftPanelWidth]);

  const leftMouseDown = useRef(false);
  const leftStartX = useRef(0);
  const leftStartWidth = useRef(0);

  const handleLeftMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      leftMouseDown.current = true;
      leftStartX.current = event.clientX;
      leftStartWidth.current = leftPanelWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!leftMouseDown.current) {
          return;
        }

        const dx = moveEvent.clientX - leftStartX.current;
        const nextWidth = Math.min(
          MAX_LEFT_WIDTH,
          Math.max(MIN_LEFT_WIDTH, leftStartWidth.current + dx)
        );
        setLeftPanelWidth(nextWidth);
      };

      const onMouseUp = () => {
        leftMouseDown.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [leftPanelWidth, setLeftPanelWidth]
  );

  const bottomMouseDown = useRef(false);
  const bottomStartY = useRef(0);
  const bottomStartHeight = useRef(0);

  const handleBottomMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      bottomMouseDown.current = true;
      bottomStartY.current = event.clientY;
      bottomStartHeight.current = bottomPanelHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!bottomMouseDown.current) {
          return;
        }

        const dy = bottomStartY.current - moveEvent.clientY;
        const nextHeight = Math.min(
          MAX_BOTTOM_HEIGHT,
          Math.max(MIN_BOTTOM_HEIGHT, bottomStartHeight.current + dy)
        );
        setBottomPanelHeight(nextHeight);
      };

      const onMouseUp = () => {
        bottomMouseDown.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [bottomPanelHeight, setBottomPanelHeight]
  );

  return {
    bottomPanelHeight,
    handleBottomMouseDown,
    handleLeftMouseDown,
    leftPanelWidth,
  };
}
