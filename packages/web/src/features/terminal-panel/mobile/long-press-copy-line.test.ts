import { describe, expect, it } from "vitest";

import { getLogicalLineTextFromTouchPoint } from "./long-press-copy-line";

interface MockBufferLine {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

function createBufferLine(text: string, isWrapped = false): MockBufferLine {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

function createTerminal(
  viewportY: number,
  lines: Array<[row: number, line: MockBufferLine]>
): {
  buffer: {
    active: {
      viewportY: number;
      getLine(row: number): MockBufferLine | undefined;
    };
  };
} {
  const byRow = new Map(lines);
  return {
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

    const terminal = createTerminal(10, [[11, createBufferLine("beta")]]);

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

    const terminal = createTerminal(20, [
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

    const terminal = createTerminal(30, [
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

    const terminal = createTerminal(40, [[40, createBufferLine("alpha")]]);

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

    const terminal = createTerminal(50, [[51, createBufferLine("suffix   ", true)]]);

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

    const terminal = createTerminal(0, [[0, createBufferLine("ignored")]]);

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

    const terminal = createTerminal(60, [[62, createBufferLine("gamma")]]);

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
    const secondRowText = secondRow.querySelector("span span") as HTMLSpanElement | null;
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
    secondRowText!.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 120,
        top: 120,
        left: 20,
        width: 80,
        height: 20,
        right: 100,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const terminal = createTerminal(70, [[71, createBufferLine("beta")]]);

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
});
