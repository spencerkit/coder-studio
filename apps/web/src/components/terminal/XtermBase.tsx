import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import type { TerminalCompatibilityMode } from "../../types/app";
import { resetTerminalMeasurementCache, resolveTerminalFontFamily, XTERM_SCROLLBAR_WIDTH } from "../../shared/utils/terminal";
import { shouldRefreshTerminalAfterFit } from "./xterm-fit-refresh";

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
  compatibilityMode?: TerminalCompatibilityMode;
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

const resolveTerminalThemeSource = (mount: HTMLElement | null) => {
  if (!mount) return null;
  return mount.closest(".agent-pane-card")
    ?? mount.closest(".terminal-card")
    ?? mount.closest(".app");
};

const readTerminalGeometry = (mount: HTMLElement | null) => {
  if (!mount) return null;
  return {
    width: mount.clientWidth,
    height: mount.clientHeight,
  };
};

export const XtermBase = forwardRef<XtermBaseHandle, XtermBaseProps>(({
  output,
  outputIdentity,
  themeIdentity,
  theme,
  fontSize,
  compatibilityMode = "standard",
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
  const geometryRef = useRef<{ width: number; height: number } | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const onDataRef = useRef(onData);
  const onSizeRef = useRef(onSize);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onSizeRef.current = onSize;
  }, [onSize]);

  const emitSize = useCallback(() => {
    const term = termRef.current;
    const reportSize = onSizeRef.current;
    if (!term || !reportSize) return;
    const next = { cols: term.cols, rows: term.rows };
    if (sizeRef.current?.cols === next.cols && sizeRef.current?.rows === next.rows) return;
    sizeRef.current = next;
    reportSize(next);
  }, []);

  const fitAndReport = useCallback(() => {
    const mount = mountRef.current;
    const term = termRef.current;
    const previousGeometry = geometryRef.current;
    const nextGeometry = readTerminalGeometry(mount);
    const previousSize = term ? { cols: term.cols, rows: term.rows } : null;

    fitRef.current?.fit();

    const nextSize = term ? { cols: term.cols, rows: term.rows } : null;
    geometryRef.current = nextGeometry;
    if (term && shouldRefreshTerminalAfterFit({
      previousGeometry,
      nextGeometry,
      previousSize,
      nextSize,
    })) {
      term.refresh(0, Math.max(term.rows - 1, 0));
    }
    emitSize();
  }, [emitSize]);

  const cancelScheduledFit = useCallback(() => {
    if (fitFrameRef.current === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = null;
  }, []);

  const flushFit = useCallback(() => {
    cancelScheduledFit();
    fitAndReport();
  }, [cancelScheduledFit, fitAndReport]);

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) return;
    if (typeof window === "undefined") {
      fitAndReport();
      return;
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitAndReport();
    });
  }, [fitAndReport]);

  useEffect(() => () => {
    cancelScheduledFit();
  }, [cancelScheduledFit]);

  useEffect(() => {
    const mount = mountRef.current;
    const fontFamily = resolveTerminalFontFamily(compatibilityMode);
    if (!mount) return;
    if (!termRef.current) {
      const term = new XTerminal({
        allowProposedApi: true,
        convertEol: true,
        customGlyphs: true,
        disableStdin: mode === "readonly",
        cursorBlink: mode === "interactive",
        fontFamily,
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
      geometryRef.current = readTerminalGeometry(mount);
      fitAndReport();
      return;
    }
    fitAndReport();
  }, [compatibilityMode, fitAndReport, fontSize, mode]);

  useEffect(() => {
    const mount = mountRef.current;
    const term = termRef.current;
    if (!mount || !term) return;
    const fontFamily = resolveTerminalFontFamily(compatibilityMode);
    term.options = {
      allowProposedApi: true,
      customGlyphs: true,
      disableStdin: mode === "readonly",
      cursorBlink: mode === "interactive",
      fontFamily,
      fontSize,
      rescaleOverlappingGlyphs: true,
      overviewRuler: { width: XTERM_SCROLLBAR_WIDTH },
      theme: readTerminalTheme(resolveTerminalThemeSource(mount))
    };
    scheduleFit();
  }, [compatibilityMode, fontSize, mode, scheduleFit, theme, themeIdentity]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(mount);
    return () => observer.disconnect();
  }, [scheduleFit]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let dprMediaQuery: MediaQueryList | null = null;
    let removeDprListener = () => {};

    const registerDprListener = () => {
      removeDprListener();
      const dpr = window.devicePixelRatio || 1;
      dprMediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
      const onChange = () => {
        scheduleFit();
        registerDprListener();
      };

      if (typeof dprMediaQuery.addEventListener === "function") {
        dprMediaQuery.addEventListener("change", onChange);
        removeDprListener = () => dprMediaQuery?.removeEventListener("change", onChange);
        return;
      }

      dprMediaQuery.addListener(onChange);
      removeDprListener = () => dprMediaQuery?.removeListener(onChange);
    };

    const onWindowResize = () => scheduleFit();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleFit();
      }
    };

    registerDprListener();
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("pageshow", onWindowResize);
    window.visualViewport?.addEventListener("resize", onWindowResize);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      removeDprListener();
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("pageshow", onWindowResize);
      window.visualViewport?.removeEventListener("resize", onWindowResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scheduleFit]);

  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    const fontSet = document.fonts;
    let cancelled = false;

    const refit = () => {
      if (cancelled) return;
      resetTerminalMeasurementCache();
      scheduleFit();
    };

    void fontSet.ready.then(refit).catch(() => undefined);
    fontSet.addEventListener?.("loadingdone", refit);

    return () => {
      cancelled = true;
      fontSet.removeEventListener?.("loadingdone", refit);
    };
  }, [fontSize, scheduleFit]);

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
    if (!term || mode !== "interactive") return;
    const disposable = term.onData((value) => {
      onDataRef.current?.(value);
    });
    return () => disposable.dispose();
  }, [mode]);

  useEffect(() => {
    if (!autoFocus) return;
    termRef.current?.focus();
  }, [autoFocus, outputIdentity]);

  useImperativeHandle(ref, () => ({
    fit: flushFit,
    focus: () => {
      termRef.current?.focus();
    },
    size: () => {
      const term = termRef.current;
      if (!term) return null;
      return { cols: term.cols, rows: term.rows };
    }
  }), [flushFit]);

  useEffect(() => {
    return () => {
      cancelScheduledFit();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      unicodeRef.current = null;
      outputSnapshotRef.current = "";
      identityRef.current = undefined;
      sizeRef.current = null;
      geometryRef.current = null;
    };
  }, [cancelScheduledFit]);

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
