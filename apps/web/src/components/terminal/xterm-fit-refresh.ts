type TerminalGeometry = {
  width: number;
  height: number;
};

type TerminalGridSize = {
  cols: number;
  rows: number;
};

export const shouldRefreshTerminalAfterFit = (input: {
  previousGeometry?: TerminalGeometry | null;
  nextGeometry?: TerminalGeometry | null;
  previousSize?: TerminalGridSize | null;
  nextSize?: TerminalGridSize | null;
}) => {
  const {
    previousGeometry,
    nextGeometry,
    previousSize,
    nextSize,
  } = input;

  if (!previousGeometry || !nextGeometry || !previousSize || !nextSize) {
    return false;
  }

  const geometryChanged = previousGeometry.width !== nextGeometry.width
    || previousGeometry.height !== nextGeometry.height;
  if (!geometryChanged) {
    return false;
  }

  return previousSize.cols === nextSize.cols
    && previousSize.rows === nextSize.rows;
};
