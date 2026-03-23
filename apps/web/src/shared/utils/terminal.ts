export type TerminalGridSize = {
  cols: number;
  rows: number;
};

export const XTERM_SCROLLBAR_WIDTH = 3;

export const XTERM_FONT_FAMILY = [
  "\"JetBrains Mono\"",
  "\"Symbols Nerd Font Mono\"",
  "\"MesloLGS NF\"",
  "\"CaskaydiaMono Nerd Font Mono\"",
  "\"SauceCodePro Nerd Font Mono\"",
  "\"DejaVu Sans Mono\"",
  "\"Noto Sans Mono\"",
  "\"Noto Sans Mono CJK SC\"",
  "\"Noto Sans Symbols 2\"",
  "\"Noto Color Emoji\"",
  "\"Cascadia Mono\"",
  "ui-monospace",
  "\"SFMono-Regular\"",
  "monospace",
].join(", ");

const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 8;
const TERMINAL_HORIZONTAL_GUTTER = XTERM_SCROLLBAR_WIDTH + 4;
const TERMINAL_VERTICAL_GUTTER = 2;
const cellMeasureCache = new Map<number, { width: number; height: number }>();

const measureTerminalCell = (fontSize: number) => {
  if (typeof document === "undefined") {
    return null;
  }

  const cached = cellMeasureCache.get(fontSize);
  if (cached) {
    return cached;
  }

  const probe = document.createElement("span");
  probe.textContent = "WWWWWWWWWWWWWWWW";
  Object.assign(probe.style, {
    position: "absolute",
    top: "-9999px",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre",
    padding: "0",
    margin: "0",
    border: "0",
    lineHeight: "1",
    letterSpacing: "0",
    fontKerning: "none",
    fontFamily: XTERM_FONT_FAMILY,
    fontSize: `${fontSize}px`,
  });

  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const sampleLength = Math.max(probe.textContent?.length ?? 0, 1);
  const measured = {
    width: rect.width / sampleLength,
    height: rect.height,
  };

  if (measured.width > 0 && measured.height > 0) {
    cellMeasureCache.set(fontSize, measured);
    return measured;
  }

  return null;
};

export const estimateTerminalGrid = (
  container: HTMLElement | null,
  fontSize: number,
): TerminalGridSize | null => {
  if (typeof window === "undefined" || !container) {
    return null;
  }

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const styles = window.getComputedStyle(container);
  const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const innerWidth = Math.max(0, width - paddingX - TERMINAL_HORIZONTAL_GUTTER);
  const innerHeight = Math.max(0, height - paddingY - TERMINAL_VERTICAL_GUTTER);
  if (innerWidth <= 0 || innerHeight <= 0) {
    return null;
  }

  const cell = measureTerminalCell(fontSize);
  if (!cell) {
    return null;
  }

  return {
    cols: Math.max(MIN_TERMINAL_COLS, Math.floor(innerWidth / cell.width)),
    rows: Math.max(MIN_TERMINAL_ROWS, Math.floor(innerHeight / cell.height)),
  };
};
