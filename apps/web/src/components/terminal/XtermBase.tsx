import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";

type XtermBaseMode = "interactive" | "readonly";

export type XtermBaseHandle = {
  fit: () => void;
  focus: () => void;
  size: () => { cols: number; rows: number } | null;
};

export type XtermBaseProps = {
  output: string;
  outputIdentity?: string;
  themeIdentity?: string;
  theme: "dark";
  fontSize: number;
  mode?: XtermBaseMode;
  className?: string;
  sanitizeOutput?: (value: string) => string;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
  autoFocus?: boolean;
};

const readTerminalTheme = (source?: Element | null) => {
  if (typeof window === "undefined") {
    return {
      background: "#0b151a",
      foreground: "#d8edf4",
      cursor: "#8fffae",
      cursorAccent: "#0d1418"
    };
  }
  const styles = window.getComputedStyle((source as Element | null) ?? document.documentElement);
  const rootStyles = window.getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || rootStyles.getPropertyValue(name).trim() || fallback;

  return {
    background: readVar("--terminal-bg", "#0b151a"),
    foreground: readVar("--terminal-fg", "#d8edf4"),
    cursor: readVar("--terminal-cursor", "#8fffae"),
    cursorAccent: readVar("--terminal-cursor-accent", "#0d1418"),
    selectionBackground: readVar("--terminal-selection", "rgba(90, 200, 250, 0.3)"),
    selectionInactiveBackground: readVar("--terminal-selection-inactive", "rgba(90, 200, 250, 0.2)"),
    black: readVar("--ansi-black", "#5f7680"),
    red: readVar("--ansi-red", "#ff9eb0"),
    green: readVar("--ansi-green", "#8fffae"),
    yellow: readVar("--ansi-yellow", "#ffd37a"),
    blue: readVar("--ansi-blue", "#5ac8fa"),
    magenta: readVar("--ansi-magenta", "#b9a4ff"),
    cyan: readVar("--ansi-cyan", "#79f6de"),
    white: readVar("--ansi-white", "#e7f3f7"),
    brightBlack: readVar("--ansi-bright-black", "#8da6b0"),
    brightRed: readVar("--ansi-bright-red", "#ffbac6"),
    brightGreen: readVar("--ansi-bright-green", "#b8ffca"),
    brightYellow: readVar("--ansi-bright-yellow", "#ffe7a6"),
    brightBlue: readVar("--ansi-bright-blue", "#9edfff"),
    brightMagenta: readVar("--ansi-bright-magenta", "#d8caff"),
    brightCyan: readVar("--ansi-bright-cyan", "#a7fff0"),
    brightWhite: readVar("--ansi-bright-white", "#f4fbfd")
  };
};

const resolveXtermAppendDelta = (previous: string, next: string) => {
  if (next === previous) return "";
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  const probeLength = Math.min(256, next.length);
  if (probeLength === 0) return null;
  const probe = next.slice(0, probeLength);
  const overlapStart = previous.lastIndexOf(probe);
  if (overlapStart === -1) return null;

  const overlap = previous.slice(overlapStart);
  if (!next.startsWith(overlap)) return null;
  return next.slice(overlap.length);
};

const writeXtermSnapshot = (term: XTerminal, previous: string, next: string) => {
  if (next === previous) return;
  const delta = resolveXtermAppendDelta(previous, next);
  if (delta !== null) {
    if (delta) term.write(delta);
    return;
  }
  term.reset();
  if (next) term.write(next);
};

const XTERM_SCROLLBAR_WIDTH = 3;
const XTERM_FONT_FAMILY = [
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

const resolveTerminalThemeSource = (mount: HTMLElement | null) => {
  if (!mount) return null;
  return mount.closest(".agent-pane-card")
    ?? mount.closest(".terminal-card")
    ?? mount.closest(".app");
};

export const XtermBase = forwardRef<XtermBaseHandle, XtermBaseProps>(({
  output,
  outputIdentity,
  themeIdentity,
  theme,
  fontSize,
  mode = "interactive",
  className = "agent-pane-xterm",
  sanitizeOutput,
  onData,
  onSize,
  autoFocus = false
}, ref) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unicodeRef = useRef<Unicode11Addon | null>(null);
  const outputSnapshotRef = useRef("");
  const identityRef = useRef<string | undefined>(undefined);
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const emitSize = useCallback(() => {
    const term = termRef.current;
    if (!term || !onSize) return;
    const next = { cols: term.cols, rows: term.rows };
    if (sizeRef.current?.cols === next.cols && sizeRef.current?.rows === next.rows) return;
    sizeRef.current = next;
    onSize(next);
  }, [onSize]);

  const fitAndReport = useCallback(() => {
    fitRef.current?.fit();
    emitSize();
  }, [emitSize]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!termRef.current) {
      const term = new XTerminal({
        convertEol: true,
        customGlyphs: true,
        disableStdin: mode === "readonly",
        cursorBlink: mode === "interactive",
        fontFamily: XTERM_FONT_FAMILY,
        fontSize,
        rescaleOverlappingGlyphs: true,
        overviewRuler: { width: XTERM_SCROLLBAR_WIDTH },
        theme: readTerminalTheme(resolveTerminalThemeSource(mount))
      });
      const fitAddon = new FitAddon();
      const unicodeAddon = new Unicode11Addon();
      term.loadAddon(fitAddon);
      term.loadAddon(unicodeAddon);
      term.unicode.activeVersion = "11";
      term.open(mount);
      termRef.current = term;
      fitRef.current = fitAddon;
      unicodeRef.current = unicodeAddon;
      outputSnapshotRef.current = "";
      identityRef.current = undefined;
      sizeRef.current = null;
      fitAndReport();
      return;
    }
    fitAndReport();
  }, [fitAndReport, fontSize, mode]);

  useEffect(() => {
    const mount = mountRef.current;
    const term = termRef.current;
    if (!mount || !term) return;
    term.options = {
      customGlyphs: true,
      disableStdin: mode === "readonly",
      cursorBlink: mode === "interactive",
      fontFamily: XTERM_FONT_FAMILY,
      fontSize,
      rescaleOverlappingGlyphs: true,
      overviewRuler: { width: XTERM_SCROLLBAR_WIDTH },
      theme: readTerminalTheme(resolveTerminalThemeSource(mount))
    };
    requestAnimationFrame(() => fitAndReport());
  }, [fitAndReport, fontSize, mode, theme, themeIdentity]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const observer = new ResizeObserver(() => {
      fitAndReport();
    });
    observer.observe(mount);
    return () => observer.disconnect();
  }, [fitAndReport]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (identityRef.current !== outputIdentity) {
      term.reset();
      outputSnapshotRef.current = "";
      identityRef.current = outputIdentity;
    }
    const normalized = sanitizeOutput ? sanitizeOutput(output) : output;
    writeXtermSnapshot(term, outputSnapshotRef.current, normalized);
    outputSnapshotRef.current = normalized;
  }, [output, outputIdentity, sanitizeOutput]);

  useEffect(() => {
    if (outputIdentity === undefined) return;
    sizeRef.current = null;
    emitSize();
  }, [emitSize, outputIdentity]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || mode !== "interactive" || !onData) return;
    const disposable = term.onData(onData);
    return () => disposable.dispose();
  }, [mode, onData]);

  useEffect(() => {
    if (!autoFocus) return;
    termRef.current?.focus();
  }, [autoFocus, outputIdentity]);

  useImperativeHandle(ref, () => ({
    fit: fitAndReport,
    focus: () => {
      termRef.current?.focus();
    },
    size: () => {
      const term = termRef.current;
      if (!term) return null;
      return { cols: term.cols, rows: term.rows };
    }
  }), [fitAndReport]);

  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      unicodeRef.current = null;
      outputSnapshotRef.current = "";
      identityRef.current = undefined;
      sizeRef.current = null;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={className}
      onClick={() => {
        if (mode === "interactive") {
          termRef.current?.focus();
        }
      }}
    />
  );
});

XtermBase.displayName = "XtermBase";
