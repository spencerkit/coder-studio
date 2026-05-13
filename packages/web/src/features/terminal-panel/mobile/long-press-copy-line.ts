interface BufferLineLike {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface ActiveBufferLike {
  viewportY: number;
  getLine(row: number): BufferLineLike | undefined;
}

export interface TerminalLikeForLongPressCopy {
  cols: number;
  buffer: {
    active: ActiveBufferLike;
  };
}

export interface GetLogicalLineTextFromTouchPointArgs {
  clientX: number;
  clientY: number;
  rowsElement: HTMLElement;
  screenElement?: HTMLElement;
  terminal: TerminalLikeForLongPressCopy;
}

function getVisualRowContentLength(line: BufferLineLike): number {
  return line.translateToString(true).length;
}

function getVisualRowIndexFromTouchPoint(rowsElement: HTMLElement, clientY: number): number | null {
  const rowElements = Array.from(rowsElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  for (let index = 0; index < rowElements.length; index += 1) {
    const rowElement = rowElements[index];
    const rowRect = rowElement.getBoundingClientRect();
    if (clientY < rowRect.top || clientY > rowRect.bottom) {
      continue;
    }

    return index;
  }

  return null;
}

function getBufferRowFromTouchPoint(
  rowsElement: HTMLElement,
  screenElement: HTMLElement | undefined,
  terminal: TerminalLikeForLongPressCopy,
  clientX: number,
  clientY: number
): number | null {
  const rowsRect = rowsElement.getBoundingClientRect();
  const horizontalBoundsElement = screenElement ?? rowsElement;
  const horizontalRect = horizontalBoundsElement.getBoundingClientRect();
  if (
    clientX < rowsRect.left ||
    clientX > rowsRect.right ||
    clientY < rowsRect.top ||
    clientY > rowsRect.bottom
  ) {
    return null;
  }

  const visualRowIndex = getVisualRowIndexFromTouchPoint(rowsElement, clientY);
  if (visualRowIndex === null) {
    return null;
  }

  const bufferRow = terminal.buffer.active.viewportY + visualRowIndex;
  const line = terminal.buffer.active.getLine(bufferRow);
  if (!line) {
    return null;
  }

  if (!Number.isFinite(terminal.cols) || terminal.cols <= 0 || horizontalRect.width <= 0) {
    return null;
  }

  const contentLength = getVisualRowContentLength(line);
  if (contentLength === 0) {
    return bufferRow;
  }

  if (clientX < horizontalRect.left || clientX > horizontalRect.right) {
    return null;
  }

  const cellWidth = horizontalRect.width / terminal.cols;
  if (cellWidth <= 0) {
    return null;
  }

  const columnIndex = Math.floor((clientX - horizontalRect.left) / cellWidth);
  if (columnIndex < 0 || columnIndex >= terminal.cols) {
    return null;
  }

  if (columnIndex >= contentLength) {
    return null;
  }

  return bufferRow;
}

function getLogicalLineTextFromBufferRow(
  terminal: TerminalLikeForLongPressCopy,
  bufferRow: number
): string | null {
  const activeBuffer = terminal.buffer.active;

  let startRow = bufferRow;
  let currentLine = activeBuffer.getLine(startRow);
  if (!currentLine) {
    return null;
  }

  while (currentLine.isWrapped === true) {
    startRow -= 1;
    if (startRow < 0) {
      return null;
    }

    currentLine = activeBuffer.getLine(startRow);
    if (!currentLine) {
      return null;
    }
  }

  const segments: BufferLineLike[] = [currentLine];
  let scanRow = startRow;

  while (true) {
    const nextLine = activeBuffer.getLine(scanRow + 1);
    if (!nextLine || nextLine.isWrapped !== true) {
      break;
    }

    segments.push(nextLine);
    scanRow += 1;
  }

  return segments
    .map((line, index) => line.translateToString(index === segments.length - 1))
    .join("");
}

export function getLogicalLineTextFromTouchPoint(
  args: GetLogicalLineTextFromTouchPointArgs
): string | null {
  const bufferRow = getBufferRowFromTouchPoint(
    args.rowsElement,
    args.screenElement,
    args.terminal,
    args.clientX,
    args.clientY
  );
  if (bufferRow === null) {
    return null;
  }

  return getLogicalLineTextFromBufferRow(args.terminal, bufferRow);
}
