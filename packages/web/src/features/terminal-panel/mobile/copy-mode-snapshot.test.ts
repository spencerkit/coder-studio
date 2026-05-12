import { describe, expect, it } from "vitest";

import { buildTerminalCopyModeSnapshot } from "./copy-mode-snapshot";

function createRect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

function parseSnapshotHtml(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("buildTerminalCopyModeSnapshot", () => {
  it("clones visible xterm rows into selectable overlay markup", () => {
    const container = document.createElement("div");
    const rowsElement = document.createElement("div");
    rowsElement.className = "xterm-rows";
    rowsElement.innerHTML = `
      <div style="position: absolute; top: 12px; transform: translateY(12px); height: 20px; line-height: 20px;">
        <span style="color: rgb(255, 0, 0); font-weight: 700; font-style: italic;">hi there</span>
      </div>
      <div style="position: absolute; top: 32px; transform: translateY(32px); height: 20px; line-height: 20px;">
        <span>ab</span>
      </div>
    `;
    container.append(rowsElement);
    document.body.append(container);

    container.getBoundingClientRect = () => createRect(10, 20, 100, 40);
    rowsElement.getBoundingClientRect = () => createRect(30, 35, 80, 40);

    const snapshot = buildTerminalCopyModeSnapshot({
      rowsElement,
      cols: 5,
      fontFamily: "JetBrains Mono",
      fontSize: 14,
      lineHeightPx: 20,
    });
    const clonedRoot = parseSnapshotHtml(snapshot?.html ?? "");
    const clonedRows = Array.from(clonedRoot.children) as HTMLElement[];
    const [firstRow, secondRow] = clonedRows;
    const firstSpan = firstRow?.querySelector("span");
    const paddingSpan = secondRow?.lastElementChild;

    expect(snapshot).toEqual({
      html: expect.any(String),
      text: "hi there\nab   ",
      fontFamily: "JetBrains Mono",
      fontSize: 14,
      lineHeightPx: 20,
    });
    expect(clonedRows).toHaveLength(2);
    expect(firstRow.style.position).toBe("static");
    expect(firstRow.style.top).toBe("0px");
    expect(firstRow.style.left).toBe("0px");
    expect(firstRow.style.transform).toBe("none");
    expect(firstRow.style.height).toBe("20px");
    expect(firstRow.style.lineHeight).toBe("20px");
    expect(firstRow.style.whiteSpace).toBe("pre");
    expect(firstSpan).not.toBeNull();
    expect((firstSpan as HTMLElement).style.color).toBe("rgb(255, 0, 0)");
    expect((firstSpan as HTMLElement).style.fontWeight).toBe("700");
    expect((firstSpan as HTMLElement).style.fontStyle).toBe("italic");
    expect(firstSpan?.textContent).toBe("hi\u00a0there");
    expect(paddingSpan?.textContent).toBe("\u00a0\u00a0\u00a0");
    expect(paddingSpan?.previousElementSibling?.textContent).toBe("ab");

    container.remove();
  });

  it("pads plain text lines to terminal columns", () => {
    const container = document.createElement("div");
    const rowsElement = document.createElement("div");
    rowsElement.innerHTML = `<div><span>a</span></div>`;
    container.append(rowsElement);

    container.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 10,
        height: 10,
        right: 10,
        bottom: 10,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    rowsElement.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        width: 10,
        height: 10,
        right: 10,
        bottom: 10,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;

    const snapshot = buildTerminalCopyModeSnapshot({
      rowsElement,
      cols: 3,
      fontFamily: "mono",
      fontSize: 12,
      lineHeightPx: 18,
    });

    expect(snapshot?.text).toBe("a  ");
  });

  it("pads full-width CJK text using terminal cell width", () => {
    const container = document.createElement("div");
    const rowsElement = document.createElement("div");
    rowsElement.innerHTML = `<div><span>你</span></div>`;
    container.append(rowsElement);

    container.getBoundingClientRect = () => createRect(0, 0, 10, 10);
    rowsElement.getBoundingClientRect = () => createRect(0, 0, 10, 10);

    const snapshot = buildTerminalCopyModeSnapshot({
      rowsElement,
      cols: 4,
      fontFamily: "mono",
      fontSize: 12,
      lineHeightPx: 18,
    });
    const clonedRoot = parseSnapshotHtml(snapshot?.html ?? "");
    const row = clonedRoot.firstElementChild as HTMLElement | null;
    const paddingSpan = row?.lastElementChild;

    expect(snapshot?.text).toBe("你  ");
    expect(paddingSpan?.textContent).toBe("\u00a0\u00a0");
  });

  it("pads combining text using terminal cell width", () => {
    const container = document.createElement("div");
    const rowsElement = document.createElement("div");
    rowsElement.innerHTML = `<div><span>e\u0301</span></div>`;
    container.append(rowsElement);

    container.getBoundingClientRect = () => createRect(0, 0, 10, 10);
    rowsElement.getBoundingClientRect = () => createRect(0, 0, 10, 10);

    const snapshot = buildTerminalCopyModeSnapshot({
      rowsElement,
      cols: 3,
      fontFamily: "mono",
      fontSize: 12,
      lineHeightPx: 18,
    });
    const clonedRoot = parseSnapshotHtml(snapshot?.html ?? "");
    const row = clonedRoot.firstElementChild as HTMLElement | null;
    const paddingSpan = row?.lastElementChild;

    expect(snapshot?.text).toBe("e\u0301  ");
    expect(paddingSpan?.textContent).toBe("\u00a0\u00a0");
  });

  it("returns null when rowsElement is missing", () => {
    const snapshot = buildTerminalCopyModeSnapshot({
      rowsElement: null,
      cols: 80,
      fontFamily: "mono",
      fontSize: 12,
      lineHeightPx: 18,
    });

    expect(snapshot).toBeNull();
  });
});
