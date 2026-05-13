import { describe, expect, it } from "vitest";

import { getLogicalLineTextFromTouchPoint } from "./long-press-copy-line";

interface MockBufferLine {
  isWrapped?: boolean;
  length: number;
  getCell(column: number): { getChars(): string; getWidth(): number } | undefined;
  getNoBgTrimmedLength(): number;
  getCellWidthTrimmedLength(): number;
  translateToString(trimRight?: boolean): string;
}

function createBufferLine(
  text: string,
  isWrapped = false,
  noBgTrimmedLength = text.replace(/\s+$/u, "").length,
  cellWidthTrimmedLength = text.replace(/\s+$/u, "").length
): MockBufferLine {
  const trimmedText = text.replace(/\s+$/u, "");
  const columnCells = Array.from({ length: cellWidthTrimmedLength }, () => ({
    chars: "",
    width: 1,
  }));
  if (trimmedText.length > 0 && cellWidthTrimmedLength > 0) {
    columnCells[0] = {
      chars: trimmedText,
      width: cellWidthTrimmedLength,
    };
    for (let column = 1; column < cellWidthTrimmedLength; column += 1) {
      columnCells[column] = {
        chars: "",
        width: 0,
      };
    }
  }

  return {
    isWrapped,
    length: columnCells.length,
    getCell(column: number) {
      const cell = columnCells[column];
      if (!cell) {
        return undefined;
      }

      return {
        getChars() {
          return cell.chars;
        },
        getWidth() {
          return cell.width;
        },
      };
    },
    getNoBgTrimmedLength() {
      return noBgTrimmedLength;
    },
    getCellWidthTrimmedLength() {
      return cellWidthTrimmedLength;
    },
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function createTerminal(
  cols: number,
  viewportY: number,
  lines: Array<[row: number, line: MockBufferLine]>
): {
  cols: number;
  buffer: {
    active: {
      viewportY: number;
      getLine(row: number): MockBufferLine | undefined;
    };
  };
} {
  const byRow = new Map(lines);
  return {
    cols,
    buffer: {
      active: {
        viewportY,
        getLine(row: number) {
          return byRow.get(row);
        },
      },
    },
  };
}

function createRowsDom() {
  const rows = document.createElement("div");
  rows.className = "xterm-rows";

  const firstRow = document.createElement("div");
  firstRow.innerHTML = "<span>first</span>";

  const secondRow = document.createElement("div");
  secondRow.innerHTML = "<span><span>second</span></span>";

  const thirdRow = document.createElement("div");
  thirdRow.innerHTML = "<span><span>third</span></span>";

  rows.append(firstRow, secondRow, thirdRow);

  return {
    rows,
    secondRow,
    thirdRow,
  };
}

describe("getLogicalLineTextFromTouchPoint", () => {
  it("maps the touched visual row through viewportY", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 10, [[11, createBufferLine("beta")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBe("beta");

    rows.remove();
  });

  it("walks upward and downward across wrapped rows and trims only the final segment", () => {
    const { rows, secondRow, thirdRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;
    thirdRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 140,
        top: 140,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 20, [
      [20, createBufferLine("unrelated line")],
      [21, createBufferLine("prefix ", false)],
      [22, createBufferLine("middle ", true)],
      [23, createBufferLine("suffix   ", true)],
    ]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 150,
        rowsElement: rows,
        terminal,
      })
    ).toBe("prefix middle suffix");

    rows.remove();
  });

  it("preserves meaningful internal spaces from wrapped intermediate segments", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 30, [
      [30, createBufferLine("double  ", false)],
      [31, createBufferLine("space   ", true)],
    ]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBe("double  space");

    rows.remove();
  });

  it("returns null when the mapped buffer row is missing", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 40, [[40, createBufferLine("alpha")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });

  it("returns null when a wrapped row's preceding segment is missing", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 50, [[51, createBufferLine("suffix   ", true)]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });

  it("returns null when the touch point is outside the xterm rows bounds", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 0, [[0, createBufferLine("ignored")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 180,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });

  it("maps by row bounds even when the event target is not a row descendant", () => {
    const { rows, thirdRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    thirdRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 140,
        top: 140,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 60, [[62, createBufferLine("gamma")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 150,
        rowsElement: rows,
        terminal,
      })
    ).toBe("gamma");

    rows.remove();
  });

  it("returns null when the touch point is inside a row band but outside the rendered text width", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 70, [[71, createBufferLine("beta")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 180,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });

  it("returns null when the touch point lands in bg-only trailing cells with no copyable text", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 90, [[91, createBufferLine("status", false, 10)]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 185,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });

  it("returns null when the touch point lands in the right gutter outside the screen cell grid", () => {
    const { rows, secondRow } = createRowsDom();
    const screenElement = document.createElement("div");
    document.body.append(rows, screenElement);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    screenElement.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 280,
        height: 60,
        right: 300,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 100, [[101, createBufferLine("1234567890abcdef")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 310,
        clientY: 130,
        rowsElement: rows,
        screenElement,
        terminal,
      })
    ).toBeNull();

    rows.remove();
    screenElement.remove();
  });

  it("accepts touches on the trailing half of a wide character cell", () => {
    const { rows, secondRow } = createRowsDom();
    const screenElement = document.createElement("div");
    document.body.append(rows, screenElement);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    screenElement.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 110, [[111, createBufferLine("中", false, 1, 2)]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 55,
        clientY: 130,
        rowsElement: rows,
        screenElement,
        terminal,
      })
    ).toBe("中");

    rows.remove();
    screenElement.remove();
  });

  it("returns null for an empty row when the touch point lands in the screen gutter", () => {
    const { rows, secondRow } = createRowsDom();
    const screenElement = document.createElement("div");
    document.body.append(rows, screenElement);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    screenElement.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 280,
        height: 60,
        right: 300,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(16, 120, [[121, createBufferLine("")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 310,
        clientY: 130,
        rowsElement: rows,
        screenElement,
        terminal,
      })
    ).toBeNull();

    rows.remove();
    screenElement.remove();
  });

  it("returns null when terminal columns are unavailable for horizontal hit testing", () => {
    const { rows, secondRow } = createRowsDom();
    document.body.appendChild(rows);
    rows.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 100,
        top: 100,
        left: 20,
        width: 320,
        height: 60,
        right: 340,
        bottom: 160,
        toJSON: () => ({}),
      }) as DOMRect;
    secondRow.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 320,
        height: 20,
        right: 340,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(0, 80, [[81, createBufferLine("beta")]]);

    expect(
      getLogicalLineTextFromTouchPoint({
        clientX: 40,
        clientY: 130,
        rowsElement: rows,
        terminal,
      })
    ).toBeNull();

    rows.remove();
  });
});
