import { describe, expect, it } from "vitest";

import { getLogicalLineTextFromTouchTarget } from "./long-press-copy-line";

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
    firstTarget: firstRow.querySelector("span") as HTMLSpanElement,
    secondTarget: secondRow.querySelector("span span") as HTMLSpanElement,
    thirdTarget: thirdRow.querySelector("span span") as HTMLSpanElement,
  };
}

describe("getLogicalLineTextFromTouchTarget", () => {
  it("maps the touched visual row through viewportY", () => {
    const { rows, secondTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(10, [[11, createBufferLine("beta")]]);

    expect(getLogicalLineTextFromTouchTarget({ target: secondTarget, terminal })).toBe("beta");

    rows.remove();
  });

  it("walks upward and downward across wrapped rows and trims only the final segment", () => {
    const { rows, thirdTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(20, [
      [20, createBufferLine("unrelated line")],
      [21, createBufferLine("prefix ", false)],
      [22, createBufferLine("middle ", true)],
      [23, createBufferLine("suffix   ", true)],
    ]);

    expect(getLogicalLineTextFromTouchTarget({ target: thirdTarget, terminal })).toBe(
      "prefix middle suffix"
    );

    rows.remove();
  });

  it("preserves meaningful internal spaces from wrapped intermediate segments", () => {
    const { rows, secondTarget } = createRowsDom();
    document.body.appendChild(rows);

    const terminal = createTerminal(30, [
      [30, createBufferLine("double  ", false)],
      [31, createBufferLine("space   ", true)],
    ]);

    expect(getLogicalLineTextFromTouchTarget({ target: secondTarget, terminal })).toBe(
      "double  space"
    );

    rows.remove();
  });

  it("returns null when the touch target does not resolve to a direct xterm row", () => {
    const outside = document.createElement("div");
    outside.innerHTML = "<span>outside</span>";
    document.body.appendChild(outside);

    const terminal = createTerminal(0, [[0, createBufferLine("ignored")]]);

    expect(
      getLogicalLineTextFromTouchTarget({
        target: outside.querySelector("span"),
        terminal,
      })
    ).toBeNull();

    outside.remove();
  });
});
