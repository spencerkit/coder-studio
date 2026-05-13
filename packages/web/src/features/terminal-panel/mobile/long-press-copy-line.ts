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

export interface GetLogicalLineTextFromTouchTargetArgs {
  target: EventTarget | null;
  terminal: TerminalLikeForLongPressCopy;
}

function toElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function findDirectXtermRow(target: EventTarget | null): HTMLElement | null {
  let current: Element | null = toElement(target);

  while (current) {
    const parent = current.parentElement;
    if (parent?.classList.contains("xterm-rows") && current instanceof HTMLElement) {
      return current;
    }
    current = parent;
  }

  return null;
}

export function getLogicalLineTextFromTouchTarget(
  args: GetLogicalLineTextFromTouchTargetArgs
): string | null {
  const rowElement = findDirectXtermRow(args.target);
  if (!rowElement) {
    return null;
  }

  const rowsElement = rowElement.parentElement;
  if (!rowsElement || !rowsElement.classList.contains("xterm-rows")) {
    return null;
  }

  const visualRowIndex = Array.prototype.indexOf.call(rowsElement.children, rowElement) as number;
  if (visualRowIndex < 0) {
    return null;
  }

  const activeBuffer = args.terminal.buffer.active;
  const bufferRow = activeBuffer.viewportY + visualRowIndex;

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
