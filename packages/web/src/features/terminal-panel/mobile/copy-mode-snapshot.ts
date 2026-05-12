export interface TerminalCopyModeSnapshot {
  html: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeightPx: number;
}

export interface BuildTerminalCopyModeSnapshotArgs {
  rowsElement: HTMLElement | null;
  cols: number;
  fontFamily: string;
  fontSize: number;
  lineHeightPx: number;
}

function toNbspText(value: string): string {
  return value.replace(/ /g, "\u00a0");
}

function toPlainText(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function getCellWidth(text: string): number {
  let width = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null || isCombiningCodePoint(codePoint)) {
      continue;
    }

    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }

  return width;
}

function getPaddingWidth(text: string, cols: number): number {
  return Math.max(0, cols - getCellWidth(text));
}

function padText(text: string, cols: number): string {
  return `${text}${" ".repeat(getPaddingWidth(text, cols))}`;
}

function getRowText(row: HTMLElement): string {
  return Array.from(row.querySelectorAll("span"))
    .map((span) => span.textContent ?? "")
    .join("");
}

function copySpanStyles(source: HTMLElement, target: HTMLElement): void {
  const style = window.getComputedStyle(source);
  const color = style.color;
  const fontWeight = style.fontWeight;
  const fontStyle = style.fontStyle;

  target.style.color = color;
  if (fontWeight && fontWeight !== "normal" && fontWeight !== "400") {
    target.style.fontWeight = fontWeight;
  }
  if (fontStyle && fontStyle !== "normal") {
    target.style.fontStyle = fontStyle;
  }
}

export function buildTerminalCopyModeSnapshot(
  args: BuildTerminalCopyModeSnapshotArgs
): TerminalCopyModeSnapshot | null {
  const { rowsElement, cols, fontFamily, fontSize, lineHeightPx } = args;

  if (!rowsElement) {
    return null;
  }

  const clonedRows = rowsElement.cloneNode(true) as HTMLElement;

  clonedRows.style.position = "static";
  clonedRows.style.transform = "none";
  clonedRows.style.left = "0";
  clonedRows.style.top = "0";
  clonedRows.style.pointerEvents = "auto";
  clonedRows.style.userSelect = "text";
  clonedRows.style.whiteSpace = "pre";
  clonedRows.style.fontFamily = fontFamily;
  clonedRows.style.fontSize = `${fontSize}px`;
  clonedRows.style.lineHeight = `${lineHeightPx}px`;

  const originalSpans = rowsElement.querySelectorAll("span");
  const clonedSpans = clonedRows.querySelectorAll("span");
  clonedSpans.forEach((span, index) => {
    const source = originalSpans[index] as HTMLElement | undefined;
    if (source) {
      copySpanStyles(source, span as HTMLElement);
    }

    const text = span.textContent ?? "";
    span.textContent = toNbspText(text);
  });

  Array.from(clonedRows.children).forEach((child) => {
    const row = child as HTMLElement;
    row.style.position = "static";
    row.style.top = "0";
    row.style.left = "0";
    row.style.transform = "none";
    row.style.height = `${lineHeightPx}px`;
    row.style.lineHeight = `${lineHeightPx}px`;
    row.style.whiteSpace = "pre";
    const text = getRowText(row);
    const plainText = toPlainText(text);
    const paddingWidth = getPaddingWidth(plainText, cols);
    if (paddingWidth > 0) {
      const paddingSpan = document.createElement("span");
      paddingSpan.textContent = "\u00a0".repeat(paddingWidth);
      row.appendChild(paddingSpan);
    }
  });

  const text = Array.from(clonedRows.children)
    .map((child) => padText(toPlainText(getRowText(child as HTMLElement)), cols))
    .join("\n");

  return {
    html: clonedRows.innerHTML,
    text,
    fontFamily,
    fontSize,
    lineHeightPx,
  };
}
