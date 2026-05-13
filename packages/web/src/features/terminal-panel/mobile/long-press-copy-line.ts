interface BufferLineLike {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface ActiveBufferLike {
  viewportY: number;
  getLine(row: number): BufferLineLike | undefined;
}

export interface TerminalLikeForLongPressCopy {
  buffer: {
    active: ActiveBufferLike;
  };
}

export interface GetLogicalLineTextFromTouchPointArgs {
  clientX: number;
  clientY: number;
  rowsElement: HTMLElement;
  terminal: TerminalLikeForLongPressCopy;
}

function getVisualRowIndexFromTouchPoint(
  rowsElement: HTMLElement,
  clientX: number,
  clientY: number
): number | null {
  const rowsRect = rowsElement.getBoundingClientRect();
  if (
    clientX < rowsRect.left ||
    clientX > rowsRect.right ||
    clientY < rowsRect.top ||
    clientY > rowsRect.bottom
  ) {
    return null;
  }

  const rowElements = Array.from(rowsElement.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  for (let index = 0; index < rowElements.length; index += 1) {
    const rowRect = rowElements[index].getBoundingClientRect();
    if (clientY >= rowRect.top && clientY <= rowRect.bottom) {
      return index;
    }
  }

  return null;
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
  const visualRowIndex = getVisualRowIndexFromTouchPoint(
    args.rowsElement,
    args.clientX,
    args.clientY
  );
  if (visualRowIndex === null) {
    return null;
  }

  const bufferRow = args.terminal.buffer.active.viewportY + visualRowIndex;
  return getLogicalLineTextFromBufferRow(args.terminal, bufferRow);
}
