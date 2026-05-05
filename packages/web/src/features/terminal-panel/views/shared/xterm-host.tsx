/**
 * XtermHost Component
 *
 * Renders xterm.js terminal with:
 * - FitAddon for responsive sizing
 * - WebSocket event subscription for output
 * - User input dispatch to server
 * - Aurora Mint theme that follows the current UI mode
 */

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { wsClientAtom } from '../../../../atoms/connection';
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from '../../atoms';
import { dispatchCommandAtom } from '../../../../atoms/connection';
import { themeAtom } from '../../../../atoms/app-ui';
import { useTranslation } from '../../../../lib/i18n';
import { Topics, type TerminalInputActivity } from '@coder-studio/core';
import type { OutputBuffer } from '../../atoms';
import type {
  TerminalBinaryPayload,
  TerminalReplayPayload,
  TerminalSnapshotPayload,
} from '../../../../ws/client';
import {
  classifyReplayFailure,
  TERMINAL_REPLAY_TIMEOUT_MS,
  type TerminalReplayUiState,
} from '../../replay-state';
import { useViewport } from '../../../../hooks/use-viewport';
import {
  globalHydrationCoordinator,
  type HydrationRequestHandle,
  type HydrationTier,
} from '../../hydration-coordinator';
import { usePasteDropUpload } from '../../uploads/use-paste-drop-upload';
import { XtermPlaceholder } from './xterm-placeholder';

const MOBILE_TOUCH_SCROLL_PX_PER_LINE = 16;
const TERMINAL_FOCUS_REPORTING_BYTES = new Set(['\x1b[I', '\x1b[O']);

interface TerminalInputDraftState {
  nextDraft: string;
  submittedText?: string;
}

type TouchPointLike = Pick<Touch, 'identifier' | 'clientY'>;

function isReplayGeneratedTerminalResponse(data: string): boolean {
  return /^\x1b\[\d+;\d+R$/.test(data) || /^\x1b\[(?:\?|>)(?:\d+;)*\d*c$/.test(data);
}

function classifyTerminalInput(data: string): TerminalInputActivity {
  if (TERMINAL_FOCUS_REPORTING_BYTES.has(data)) {
    return 'control';
  }

  if (data.includes('\r') || data.includes('\n')) {
    return 'submit';
  }

  return 'typing';
}

function consumeTerminalInputDraft(
  draft: string,
  data: string,
  activity: TerminalInputActivity
): TerminalInputDraftState {
  if (activity === 'control') {
    return { nextDraft: draft };
  }

  let nextDraft = draft;
  let submittedText: string | undefined;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index]!;

    if (char === '\x1b') {
      const remaining = data.slice(index);
      const escapeMatch = remaining.match(
        /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\|[@-_])/
      );
      if (escapeMatch) {
        index += escapeMatch[0].length - 1;
        continue;
      }
    }

    if (char === '\u007f' || char === '\b') {
      nextDraft = nextDraft.slice(0, -1);
      continue;
    }

    if (char === '\u0015') {
      nextDraft = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      submittedText = nextDraft.length > 0 ? nextDraft : submittedText;
      nextDraft = '';
      continue;
    }

    if (char >= ' ') {
      nextDraft += char;
    }
  }

  return { nextDraft, submittedText };
}

function getTouchAt(
  list: TouchList | ArrayLike<TouchPointLike> | undefined | null,
  index: number
): TouchPointLike | null {
  if (!list) {
    return null;
  }

  if ('item' in list && typeof list.item === 'function') {
    return list.item(index);
  }

  return list[index] ?? null;
}

function findTouchByIdentifier(
  list: TouchList | ArrayLike<TouchPointLike> | undefined | null,
  identifier: number | null
): TouchPointLike | null {
  if (identifier === null || !list) {
    return null;
  }

  for (let index = 0; index < list.length; index += 1) {
    const touch = getTouchAt(list, index);
    if (touch?.identifier === identifier) {
      return touch;
    }
  }

  return null;
}

/**
 * Aurora Mint terminal themes for xterm.js.
 * These mirror the light/dark tokens so terminals stay legible when the user
 * switches themes without needing a full remount.
 */
const AURORA_MINT_THEMES = {
  dark: {
    background: '#0b1218',
    foreground: '#e5edf3',
    cursor: '#78d7b2',
    cursorAccent: '#0b1218',
    selectionBackground: '#1e3040',
    selectionForeground: '#e5edf3',
    black: '#0a1014',
    red: '#ff9eb0',
    green: '#78d7b2',
    yellow: '#f1b86a',
    blue: '#6cb6ff',
    magenta: '#c792ea',
    cyan: '#78d7b2',
    white: '#9fb0bc',
    brightBlack: '#4a5b6a',
    brightRed: '#ff9eb0',
    brightGreen: '#78d7b2',
    brightYellow: '#f1b86a',
    brightBlue: '#6cb6ff',
    brightMagenta: '#c792ea',
    brightCyan: '#78d7b2',
    brightWhite: '#e5edf3',
  },
  light: {
    background: '#fafbfc',
    foreground: '#1f2328',
    cursor: '#0969da',
    cursorAccent: '#fafbfc',
    selectionBackground: '#dde4ea',
    selectionForeground: '#1f2328',
    black: '#24292f',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#57606a',
    brightBlack: '#8b949e',
    brightRed: '#cf222e',
    brightGreen: '#1a7f37',
    brightYellow: '#9a6700',
    brightBlue: '#0969da',
    brightMagenta: '#8250df',
    brightCyan: '#1b7c83',
    brightWhite: '#1f2328',
  },
};

function getTerminalTheme(theme: 'dark' | 'light') {
  return AURORA_MINT_THEMES[theme];
}

function shouldBypassPtyForKeyboardPaste(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') {
    return false;
  }

  if (event.shiftKey || event.altKey) {
    return false;
  }

  const isPasteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
  return isPasteShortcut;
}

const terminalInputEncoder = new TextEncoder();
const terminalTraceDecoder = new TextDecoder('utf-8', { fatal: false });
const TERMINAL_TRACE_STORAGE_KEY = 'coderStudio.terminalTrace';

function isTerminalTraceEnabled() {
  try {
    return globalThis.localStorage?.getItem(TERMINAL_TRACE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function summarizeTerminalData(data: Uint8Array | string) {
  const text = typeof data === 'string' ? data : terminalTraceDecoder.decode(data);
  return {
    length: typeof data === 'string' ? data.length : data.byteLength,
    syncStart: countOccurrences(text, '\x1b[?2026h'),
    syncEnd: countOccurrences(text, '\x1b[?2026l'),
    clearToEnd: countOccurrences(text, '\x1b[J'),
    clearScreen: countOccurrences(text, '\x1b[2J'),
    eraseLine: countOccurrences(text, '\x1b[K'),
    cursorHome: countOccurrences(text, '\x1b[1;1H'),
    dsr: countOccurrences(text, '\x1b[6n'),
    da: countOccurrences(text, '\x1b[c'),
    reverseIndex: countOccurrences(text, '\x1bM'),
    cursorMoves: text.match(/\x1b\[[0-9;]*[Hf]/g)?.length ?? 0,
    scrollRegions: text.match(/\x1b\[[0-9;]*r/g)?.slice(0, 6) ?? [],
  };
}

function traceTerminal(terminalId: string, event: string, details: Record<string, unknown> = {}) {
  if (!isTerminalTraceEnabled()) {
    return;
  }

  console.debug('[terminal-trace]', {
    at: Math.round(performance.now() * 100) / 100,
    terminalId,
    event,
    ...details,
  });
}

export function trimWrittenChunks(buffer: OutputBuffer, writtenChunkCount: number): OutputBuffer {
  const removeCount = Math.min(writtenChunkCount, buffer.chunks.length);
  if (removeCount === 0) {
    return buffer;
  }

  return {
    ...buffer,
    chunks: buffer.chunks.slice(removeCount),
  };
}

interface XtermHostProps {
  /** Terminal ID */
  terminalId: string;
  /** Workspace ID for topic subscription */
  workspaceId: string;
  /** Prevent stdin dispatch for historical or ended terminals */
  readOnly?: boolean;
  /** Marks the session prioritized by workspace UI state */
  isActiveSession?: boolean;
  /** Stable terminal kind for cold-start routing, with store metadata as fallback */
  terminalKind?: 'agent' | 'shell';
  /** Container element ref for sizing */
  containerRef?: React.RefObject<HTMLDivElement>;
}

interface ReplayPayload {
  status: 'ok' | 'too_old' | 'unknown';
  transport?: 'binary';
  streamId?: number;
  size?: number;
  seq?: number;
  bytes?: Uint8Array;
}

interface ReplayCommandResult {
  ok: boolean;
  data?: ReplayPayload;
  error?: unknown;
}

interface SnapshotPayload {
  status: 'ok' | 'unsupported';
  transport?: 'binary';
  streamId?: number;
  size?: number;
  seq?: number;
  rows?: number;
  cols?: number;
  source?: 'headless';
  bytes?: Uint8Array;
}

interface SnapshotCommandResult {
  ok: boolean;
  data?: SnapshotPayload;
  error?: unknown;
}

/**
 * XtermHost renders an xterm.js terminal instance
 *
 * Lifecycle:
 * 1. Mount: create Terminal, attach FitAddon, subscribe to events
 * 2. Update: write new output chunks from atom, fit on resize
 * 3. Unmount: dispose Terminal, unsubscribe from events
 */
export function XtermHost({
  terminalId,
  workspaceId,
  readOnly = false,
  isActiveSession = false,
  terminalKind: terminalKindProp,
}: XtermHostProps) {
  const t = useTranslation();
  const viewport = useViewport();
  const uiTheme = useAtomValue(themeAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [outputAtom, setOutputAtom] = useAtom(terminalOutputAtomFamily(terminalId));
  const meta = useAtomValue(terminalMetaAtomFamily(terminalId));
  const terminalKind = terminalKindProp ?? meta?.kind ?? 'shell';
  const isInteractive = !readOnly && meta?.alive !== false;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const fitResolversRef = useRef<Array<() => void>>([]);
  // Debounce ResizeObserver → scheduleFit so that rapid layout changes
  // (e.g. toggling the bottom terminal panel) coalesce into a single
  // fit + resize dispatch instead of firing multiple pty.resize() calls
  // that each trigger a SIGWINCH → full TUI redraw on the server side.
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactiveRef = useRef(true);
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // Buffer WS output chunks that arrive before the replay response resolves,
  // so we can reconcile them against the replay snapshot instead of writing
  // the overlapping bytes twice into xterm.
  const pendingReplayChunksRef = useRef<Array<{ bytes: Uint8Array; seq: number }>>([]);
  const replayCompletedRef = useRef(false);
  const replayedSeqRef = useRef(0);
  const coldStartStateRef = useRef<'idle' | 'in-flight' | 'done'>('idle');
  const latestRenderedSeqRef = useRef(0);
  const shouldRecoverOnNextConnectRef = useRef(false);
  // Tracks whether xterm is currently processing replay data. While > 0,
  // handleInput suppresses only known terminal auto-responses (e.g. DSR
  // `\x1b[6n` → `\x1b[row;colR`) so real user keystrokes still reach the PTY.
  const replayWriteDepthRef = useRef(0);
  const replayWriteGenerationRef = useRef(0);
  const initialThemeRef = useRef(uiTheme);
  const inputDraftRef = useRef('');
  const hydrationHandleRef = useRef<HydrationRequestHandle | null>(null);
  const hydrationReleasedRef = useRef(false);
  const reconnectRecoveryTriggerRef = useRef<(() => void) | null>(null);
  const touchScrollStateRef = useRef<{
    activeTouchId: number | null;
    lastClientY: number;
    carryPx: number;
  }>({
    activeTouchId: null,
    lastClientY: 0,
    carryPx: 0,
  });

  const [replayUiState, setReplayUiState] = useState<TerminalReplayUiState>({ kind: 'loading' });
  const [hydrationState, setHydrationState] = useState<
    | { kind: 'idle' }
    | { kind: 'queued'; queuePosition: number }
    | { kind: 'granted' }
  >(viewport === 'mobile' ? { kind: 'granted' } : { kind: 'idle' });

  // Latest copies of callback identities used inside the mount effect, exposed
  // via refs so the effect's cleanup/re-creation is not tied to their churn.
  const handleInputRef = useRef<(data: string) => void | Promise<void>>(() => {});
  const handleResizeRef = useRef<(size: { cols: number; rows: number }) => void | Promise<void>>(
    () => {}
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    initialThemeRef.current = uiTheme;
  }, [uiTheme]);

  useLayoutEffect(() => {
    if (viewport === 'mobile') {
      setHydrationState({ kind: 'granted' });
      hydrationReleasedRef.current = true;
      hydrationHandleRef.current = null;
      return;
    }

    hydrationReleasedRef.current = false;
    const tier: HydrationTier =
      meta?.alive === false
        ? 'background'
        : isActiveSession
          ? 'visible-active'
          : 'visible-other';
    const handle = globalHydrationCoordinator.request({
      terminalId,
      tier,
    });
    hydrationHandleRef.current = handle;
    setHydrationState(handle.isGranted ? { kind: 'granted' } : { kind: 'idle' });

    let cancelled = false;
    const unsubscribe = handle.subscribePosition((queuePosition) => {
      if (!cancelled) {
        setHydrationState({ kind: 'queued', queuePosition });
      }
    });

    if (!handle.isGranted) {
      void handle.granted.then(() => {
        if (!cancelled) {
          setHydrationState({ kind: 'granted' });
        }
      });
    }

    return () => {
      cancelled = true;
      unsubscribe();
      if (!hydrationReleasedRef.current) {
        handle.release();
        hydrationReleasedRef.current = true;
      }
      hydrationHandleRef.current = null;
    };
  }, [terminalId, viewport]);

  useEffect(() => {
    if (viewport === 'mobile') {
      return;
    }

    const tier: HydrationTier =
      meta?.alive === false
        ? 'background'
        : isActiveSession
          ? 'visible-active'
          : 'visible-other';
    hydrationHandleRef.current?.promote(tier);
  }, [isActiveSession, meta?.alive, viewport]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme(uiTheme);
    }
  }, [uiTheme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    if (!window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    const state = touchScrollStateRef.current;

    const resetTouchState = () => {
      state.activeTouchId = null;
      state.lastClientY = 0;
      state.carryPx = 0;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        resetTouchState();
        return;
      }

      const touch = getTouchAt(event.touches, 0);
      if (!touch) {
        resetTouchState();
        return;
      }

      state.activeTouchId = touch.identifier;
      state.lastClientY = touch.clientY;
      state.carryPx = 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = findTouchByIdentifier(event.changedTouches, state.activeTouchId);
      const terminal = terminalRef.current;
      if (!touch || !terminal) {
        return;
      }

      const viewport = terminal.buffer.active.viewportY;
      const base = terminal.buffer.active.baseY;
      if (base <= 0) {
        state.lastClientY = touch.clientY;
        state.carryPx = 0;
        return;
      }

      const deltaY = state.lastClientY - touch.clientY;
      state.lastClientY = touch.clientY;
      state.carryPx += deltaY;

      const scrollLines = state.carryPx > 0
        ? Math.floor(state.carryPx / MOBILE_TOUCH_SCROLL_PX_PER_LINE)
        : Math.ceil(state.carryPx / MOBILE_TOUCH_SCROLL_PX_PER_LINE);

      if (scrollLines === 0) {
        return;
      }

      const remainingScrollback = base - viewport;
      const allowedScrollLines = scrollLines > 0
        ? Math.min(scrollLines, remainingScrollback)
        : Math.max(scrollLines, -viewport);

      if (allowedScrollLines === 0) {
        state.carryPx = 0;
        return;
      }

      terminal.scrollLines(allowedScrollLines);
      state.carryPx -= allowedScrollLines * MOBILE_TOUCH_SCROLL_PX_PER_LINE;
      event.preventDefault();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (findTouchByIdentifier(event.changedTouches, state.activeTouchId)) {
        resetTouchState();
      }
    };

    const handleTouchCancel = () => {
      resetTouchState();
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchCancel);
      resetTouchState();
    };
  }, []);

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;

      try {
        const before = terminalRef.current
          ? { cols: terminalRef.current.cols, rows: terminalRef.current.rows }
          : null;
        fitAddonRef.current?.fit();
        const after = terminalRef.current
          ? { cols: terminalRef.current.cols, rows: terminalRef.current.rows }
          : null;
        traceTerminal(terminalId, 'fit', { before, after });
      } catch (error) {
        console.error('Failed to fit xterm instance:', error);
      } finally {
        const resolvers = fitResolversRef.current;
        fitResolversRef.current = [];
        for (const resolve of resolvers) {
          resolve();
        }
      }
    });
  }, [terminalId]);

  const waitForNextFit = useCallback(() => {
    return new Promise<void>((resolve) => {
      fitResolversRef.current.push(resolve);
    });
  }, []);

  /**
   * Handle user input - dispatch to server
   */
  const handleInput = useCallback(
    async (data: string) => {
      if (
        replayWriteDepthRef.current > 0 &&
        isReplayGeneratedTerminalResponse(data)
      ) {
        traceTerminal(terminalId, 'input.suppressed-replay-response', {
          summary: summarizeTerminalData(data),
        });
        return;
      }

      if (TERMINAL_FOCUS_REPORTING_BYTES.has(data)) {
        traceTerminal(terminalId, 'input.suppressed-focus-report', {
          summary: summarizeTerminalData(data),
        });
        return;
      }

      if (!interactiveRef.current) {
        return;
      }

      if (!wsClient) {
        console.error('Cannot send terminal input: WebSocket not connected');
        return;
      }

      try {
        const activity = classifyTerminalInput(data);
        traceTerminal(terminalId, 'input', {
          activity,
          summary: summarizeTerminalData(data),
        });
        const { nextDraft, submittedText } = consumeTerminalInputDraft(
          inputDraftRef.current,
          data,
          activity
        );
        inputDraftRef.current = nextDraft;

        await wsClient.sendTerminalInput(
          terminalId,
          terminalInputEncoder.encode(data),
          activity,
          submittedText
        );
      } catch (error) {
        console.error('Failed to send terminal input:', error);
      }
    },
    [terminalId, wsClient]
  );

  const handleResize = useCallback(
    async ({ cols, rows }: { cols: number; rows: number }) => {
      if (!interactiveRef.current) {
        return;
      }

      const previousSize = lastReportedSizeRef.current;
      if (previousSize && previousSize.cols === cols && previousSize.rows === rows) {
        return;
      }

      lastReportedSizeRef.current = { cols, rows };
      traceTerminal(terminalId, 'resize.dispatch', {
        previousSize,
        nextSize: { cols, rows },
      });

      const result = await dispatch('terminal.resize', {
        terminalId,
        cols,
        rows,
      });

      if (!result.ok) {
        console.error('Failed to sync terminal size:', result.error);
      }
      traceTerminal(terminalId, 'resize.result', {
        nextSize: { cols, rows },
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    },
    [terminalId, dispatch]
  );

  const sendTextToTerminal = useCallback(
    async (text: string) => {
      await handleInput(text);
    },
    [handleInput]
  );

  const { busy: uploadBusy } = usePasteDropUpload({
    containerRef,
    workspaceId,
    sendTextToTerminal,
    enabled: isInteractive,
  });

  useEffect(() => {
    interactiveRef.current = isInteractive;

    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = !isInteractive || uploadBusy;
      terminalRef.current.options.cursorBlink = isInteractive && !uploadBusy;
    }
  }, [isInteractive, uploadBusy]);

  // Keep callback refs in sync so the mount effect can call the latest version
  // without listing the callbacks as dependencies.
  useEffect(() => {
    handleInputRef.current = handleInput;
  }, [handleInput]);

  useEffect(() => {
    handleResizeRef.current = handleResize;
  }, [handleResize]);

  /**
   * Initialize terminal on mount.
   *
   * Deliberately scoped to (terminalId, workspaceId, wsClient): we do NOT
   * re-create the xterm instance when isInteractive, handleInput/handleResize,
   * scheduleFit, or setOutputAtom churn — those are consumed via refs. Tearing
   * down the Terminal means losing every rendered row and re-running the
   * replay, which used to amplify "blank line" artifacts on benign renders.
   */
  useEffect(() => {
    if (viewport !== 'mobile' && hydrationState.kind !== 'granted') {
      return;
    }

    if (!containerRef.current) return;

    let disposed = false;
    let unsubscribeStatus: (() => void) | null = null;
    const replayWriteGeneration = replayWriteGenerationRef.current + 1;

    replayWriteGenerationRef.current = replayWriteGeneration;
    replayWriteDepthRef.current = 0;
    reconnectRecoveryTriggerRef.current = null;
    shouldRecoverOnNextConnectRef.current = false;

    replayCompletedRef.current = false;
    replayedSeqRef.current = 0;
    coldStartStateRef.current = 'idle';
    pendingReplayChunksRef.current = [];
    lastReportedSizeRef.current = null;
    setReplayUiState({ kind: 'loading' });

    // Create Terminal instance.
    // lineHeight is left at xterm.js default (1.0) so that box-drawing
    // characters used by TUIs (claude, codex) render as a continuous frame
    // with no gaps between rows.
    const terminal = new Terminal({
      theme: getTerminalTheme(initialThemeRef.current),
      fontFamily: 'JetBrains Mono, Fira Code, SF Mono, monospace',
      fontSize: 11,
      scrollback: 5000,
      cursorBlink: isInteractive && !uploadBusy,
      cursorStyle: 'block',
      disableStdin: !isInteractive || uploadBusy,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.onResize((size) => {
      void handleResizeRef.current(size);
    });
    terminal.onData((data) => {
      void handleInputRef.current(data);
    });
    terminal.attachCustomKeyEventHandler((event) => !shouldBypassPtyForKeyboardPaste(event));

    terminal.open(containerRef.current);
    traceTerminal(terminalId, 'mount.open');
    // Defer the first fit to the next frame so flex layout has settled;
    // calling fit() synchronously right after open() sometimes runs against a
    // zero- or partial-height container and produces an off-by-one row count
    // whose leftover pixels render as a blank strip.
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();
    const initialFitReady = waitForNextFit();

    const waitForConnected = async () => {
      if (!wsClient) {
        return;
      }

      if (typeof wsClient.getStatus !== 'function' || typeof wsClient.onStatus !== 'function') {
        return;
      }

      if (wsClient.getStatus() === 'connected') {
        return;
      }

      await new Promise<void>((resolve) => {
        unsubscribeStatus = wsClient.onStatus((status) => {
          if (status === 'connected') {
            unsubscribeStatus?.();
            unsubscribeStatus = null;
            resolve();
          }
        });
      });
    };

    const initialReplayReady = initialFitReady.then(async () => {
      if (!wsClient) {
        return;
      }
      await waitForConnected();
      if (disposed || !mountedRef.current) {
        return;
      }

      const { cols, rows } = terminal;
      await handleResizeRef.current({ cols, rows });
    });

    // Wraps terminal.write with a depth guard so handleInput can tell
    // whether an onData callback originated from replay processing.
    const writeReplayBytes = (bytes: Uint8Array) => {
      replayWriteDepthRef.current += 1;
      let completed = false;
      const complete = () => {
        if (completed) {
          return;
        }
        completed = true;
        if (replayWriteGenerationRef.current !== replayWriteGeneration) {
          return;
        }
        replayWriteDepthRef.current = Math.max(0, replayWriteDepthRef.current - 1);
      };

      try {
        terminal.write(bytes, complete);
      } catch (error) {
        complete();
        throw error;
      }
    };

    const outputTopic = Topics.terminalOutput(workspaceId, terminalId);
    const exitTopic = Topics.terminalExit(workspaceId, terminalId);

    const flushPendingReplayChunks = (coveredSeq: number) => {
      const pending = pendingReplayChunksRef.current;
      pendingReplayChunksRef.current = [];

      let latestCoveredSeq = coveredSeq;
      for (const entry of pending) {
        if (entry.seq <= latestCoveredSeq) {
          continue;
        }

        writeReplayBytes(entry.bytes);
        traceTerminal(terminalId, 'write.pending-replay-chunk', {
          seq: entry.seq,
          summary: summarizeTerminalData(entry.bytes),
        });
        latestCoveredSeq = entry.seq;
      }

      replayedSeqRef.current = latestCoveredSeq;
    };

    const finishHistoricalLoad = (
      result: ReplayCommandResult | null,
      options: {
        successStatus: 'ok';
        successBytes: Uint8Array | undefined;
        coveredSeq: number | undefined;
      }
    ) => {
      if (!mountedRef.current || !terminalRef.current || !result) {
        return;
      }

      let coveredSeq = replayedSeqRef.current;
      if (result.ok && result.data?.status === options.successStatus) {
        if (options.successBytes) {
          traceTerminal(terminalId, 'write.historical', {
            seq: options.coveredSeq,
            size: options.successBytes.byteLength,
            summary: summarizeTerminalData(options.successBytes),
          });
          writeReplayBytes(options.successBytes);
        }
        coveredSeq = options.coveredSeq ?? coveredSeq;
        setReplayUiState({ kind: 'ready' });
        if (viewport !== 'mobile') {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (result.data?.status === 'too_old') {
        // Ring buffer overflow - show a message to the user
        if (terminalRef.current) {
          terminalRef.current.writeln('\r\n\x1b[33m[Session history truncated - output exceeds buffer size]\x1b[0m');
        }
        setReplayUiState({ kind: 'degraded', reason: 'truncated' });
        if (viewport !== 'mobile') {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (result.data?.status === 'unknown') {
        setReplayUiState({ kind: 'degraded', reason: 'closed' });
        if (viewport !== 'mobile') {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (!result.ok) {
        console.error('Failed to replay terminal output:', result.error);
        setReplayUiState({ kind: 'degraded', reason: classifyReplayFailure(result.error) });
        if (viewport !== 'mobile') {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      }

        setOutputAtom((prev: OutputBuffer) => ({
          ...prev,
          chunks: [],
          lastSeq: Math.max(prev.lastSeq, coveredSeq),
        }));

      replayedSeqRef.current = coveredSeq;
      latestRenderedSeqRef.current = coveredSeq;
      replayCompletedRef.current = true;
      coldStartStateRef.current = 'done';
      flushPendingReplayChunks(coveredSeq);
      reconnectRecoveryTriggerRef.current?.();
    };

    const finishReplay = (result: ReplayCommandResult | null) => {
      finishHistoricalLoad(result, {
        successStatus: 'ok',
        successBytes: result?.data?.bytes,
        coveredSeq: result?.data?.seq,
      });
    };

    const failReplay = (error: unknown) => {
      console.error('Failed to replay terminal output:', error);
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      setReplayUiState({ kind: 'degraded', reason: classifyReplayFailure(error) });
      if (viewport !== 'mobile') {
        hydrationHandleRef.current?.release();
        hydrationReleasedRef.current = true;
      }

      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
      }));

      replayCompletedRef.current = true;
      coldStartStateRef.current = 'done';
      flushPendingReplayChunks(replayedSeqRef.current);
      reconnectRecoveryTriggerRef.current?.();
    };

    const requestReplay = (lastSeq: number) => {
      if (!wsClient) {
        return;
      }
      coldStartStateRef.current = 'in-flight';
      replayCompletedRef.current = false;
      if (lastSeq === 0) {
        setReplayUiState({ kind: 'loading' });
      }
      traceTerminal(terminalId, 'replay.request', { lastSeq });

      const replayPromise: Promise<ReplayCommandResult> = wsClient
        ? wsClient
            .sendCommand<ReplayPayload>('terminal.replay', { terminalId, lastSeq }, { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS })
            .then((data) => ({ ok: true as const, data }))
        : dispatch<ReplayPayload>('terminal.replay', { terminalId, lastSeq });

      void replayPromise
        .then((result) => {
          finishReplay(result);
        })
        .catch((error) => {
          failReplay(error);
        });
    };

    const requestHistoricalRecovery = (mode: 'initial' | 'reconnect') => {
      if (!wsClient) {
        return;
      }

      coldStartStateRef.current = 'in-flight';
      replayCompletedRef.current = false;

      if (terminalKind !== 'agent') {
        if (mode === 'initial') {
          setReplayUiState({ kind: 'loading' });
        }
        requestReplay(mode === 'initial' ? 0 : latestRenderedSeqRef.current);
        return;
      }

      setReplayUiState({ kind: 'loading' });

      const snapshotPromise: Promise<SnapshotCommandResult> = wsClient
        .sendCommand<TerminalSnapshotPayload>(
          'terminal.snapshot',
          { terminalId },
          { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
        )
        .then((data) => ({ ok: true as const, data }))
        .catch((error) => ({ ok: false as const, error }));

      void snapshotPromise.then((result) => {
        if (!mountedRef.current || !terminalRef.current) {
          return;
        }

        if (result.ok && result.data?.status === 'ok') {
          finishHistoricalLoad(result, {
            successStatus: 'ok',
            successBytes: result.data.bytes,
            coveredSeq: result.data.seq,
          });
          return;
        }

        traceTerminal(terminalId, 'snapshot.fallback', {
          reason: result.ok ? result.data?.status ?? 'unsupported' : String(result.error),
        });
        requestReplay(mode === 'initial' ? 0 : latestRenderedSeqRef.current);
      });
    };

    reconnectRecoveryTriggerRef.current = () => {
      if (!shouldRecoverOnNextConnectRef.current) {
        return;
      }

      if (typeof wsClient.getStatus === 'function' && wsClient.getStatus() !== 'connected') {
        return;
      }

      if (coldStartStateRef.current === 'in-flight') {
        return;
      }

      shouldRecoverOnNextConnectRef.current = false;
      requestHistoricalRecovery('reconnect');
    };

    if (wsClient) {
      unsubscribeRef.current = wsClient.subscribe(
        [outputTopic, exitTopic],
        (topic, payload, _seq) => {
          if (topic === outputTopic) {
            const outputData = payload as TerminalBinaryPayload;
            traceTerminal(terminalId, 'live.output', {
              seq: _seq,
              replayCompleted: replayCompletedRef.current,
              replayedSeq: replayedSeqRef.current,
              size: outputData.bytes.byteLength,
              summary: summarizeTerminalData(outputData.bytes),
            });

            if (!replayCompletedRef.current) {
              pendingReplayChunksRef.current.push({
                bytes: outputData.bytes,
                seq: _seq,
              });
              return;
            }

            if (_seq <= replayedSeqRef.current) {
              traceTerminal(terminalId, 'live.drop-covered', {
                seq: _seq,
                replayedSeq: replayedSeqRef.current,
              });
              return;
            }

            const chunkStartSeq = _seq - outputData.bytes.byteLength;
            if (chunkStartSeq > replayedSeqRef.current) {
              traceTerminal(terminalId, 'live.gap', {
                seq: _seq,
                chunkStartSeq,
                replayedSeq: replayedSeqRef.current,
              });
              pendingReplayChunksRef.current.push({
                bytes: outputData.bytes,
                seq: _seq,
              });
              setOutputAtom((_prev: OutputBuffer) => ({
                chunks: [],
                lastSeq: replayedSeqRef.current,
              }));
              requestReplay(replayedSeqRef.current);
              return;
            }

            setOutputAtom((prev: OutputBuffer) => {
              if (_seq <= prev.lastSeq) return prev;
              return {
                chunks: [...prev.chunks, outputData.bytes],
                lastSeq: _seq,
              };
            });
            // Advance replayedSeqRef so subsequent contiguous chunks don't
            // trip the gap-detection branch above and trigger spurious replays
            // that re-write bytes already painted via the live path.
            replayedSeqRef.current = _seq;
          } else if (topic === exitTopic) {
            const exitData = payload as { code: number };
            if (terminalRef.current) {
              terminalRef.current.writeln(`\r\n[Process exited with code ${exitData.code}]`);
            }
          }
        }
      );
    }

    (async () => {
      await initialReplayReady;
      if (!mountedRef.current) {
        return;
      }

      requestHistoricalRecovery('initial');
    })().catch((error) => {
      failReplay(error);
    });

    return () => {
      disposed = true;
      reconnectRecoveryTriggerRef.current = null;
      shouldRecoverOnNextConnectRef.current = false;
      if (replayWriteGenerationRef.current === replayWriteGeneration) {
        replayWriteGenerationRef.current += 1;
        replayWriteDepthRef.current = 0;
      }
      if (unsubscribeStatus) {
        unsubscribeStatus();
        unsubscribeStatus = null;
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      if (terminalRef.current) {
        try {
          terminalRef.current.dispose();
        } catch (error) {
          console.error('Failed to dispose xterm instance:', error);
        }
        terminalRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [
    dispatch,
    hydrationState.kind,
    scheduleFit,
    setOutputAtom,
    terminalId,
    terminalKind,
    viewport,
    workspaceId,
    wsClient,
  ]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.onStatus !== 'function') {
      return;
    }

    let shouldRecoverOnNextConnect = false;
    const unsubscribe = wsClient.onStatus((status) => {
      if (status === 'disconnected' || status === 'reconnecting') {
        if (coldStartStateRef.current !== 'idle') {
          shouldRecoverOnNextConnect = true;
          shouldRecoverOnNextConnectRef.current = true;
        }
        return;
      }

      if (status !== 'connected' || !shouldRecoverOnNextConnect) {
        return;
      }

      shouldRecoverOnNextConnect = false;
      reconnectRecoveryTriggerRef.current?.();
    });

    return unsubscribe;
  }, [wsClient]);

  /**
   * Write new output chunks to terminal
   */
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const { chunks } = outputAtom;
    const writtenChunkCount = chunks.length;

    if (writtenChunkCount > 0) {
      const chunkEndSeqs = new Array<number>(chunks.length);
      let nextSeq = outputAtom.lastSeq;
      for (let i = chunks.length - 1; i >= 0; i -= 1) {
        chunkEndSeqs[i] = nextSeq;
        nextSeq -= chunks[i]?.byteLength ?? 0;
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;
        const chunkEndSeq = chunkEndSeqs[i] ?? outputAtom.lastSeq;

        traceTerminal(terminalId, 'write.live-buffer', {
          index: i,
          lastSeq: outputAtom.lastSeq,
          summary: summarizeTerminalData(chunk),
        });
        terminal.write(chunk, () => {
          latestRenderedSeqRef.current = Math.max(latestRenderedSeqRef.current, chunkEndSeq);
        });
      }

      setOutputAtom((prev: OutputBuffer) => trimWrittenChunks(prev, writtenChunkCount));
    }
  }, [hydrationState.kind, outputAtom, setOutputAtom, terminalId]);

  /**
   * Fit terminal on container resize
   * Uses ResizeObserver for responsive sizing
   */
  useEffect(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !fitAddon) return;

    const resizeObserver = new ResizeObserver(() => {
      traceTerminal(terminalId, 'resize-observer', {
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
      });
      if (resizeDebounceRef.current !== null) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = setTimeout(() => {
        resizeDebounceRef.current = null;
        scheduleFit();
      }, 150);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (resizeDebounceRef.current !== null) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, [scheduleFit, terminalId]);

  /**
   * Focus terminal when it becomes active
   */
  useEffect(() => {
    if (meta?.alive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [meta?.alive]);

  const showReplayOverlay =
    replayUiState.kind !== 'ready' && (viewport === 'mobile' || hydrationState.kind === 'granted');

  let replayTitle = '';
  let replayBody = '';
  let replayClassName = 'xterm-replay-overlay';

  if (replayUiState.kind === 'loading') {
    replayTitle = t('terminal.replay.loading_title');
    replayBody = t('terminal.replay.loading_body');
  } else {
    replayClassName += ' xterm-replay-overlay--degraded';
    replayTitle =
      replayUiState.reason === 'truncated'
        ? t('terminal.replay.truncated_title')
        : replayUiState.reason === 'closed'
          ? t('terminal.replay.closed_title')
        : t('terminal.replay.failed_title');
    replayBody =
      replayUiState.reason === 'truncated'
        ? t('terminal.replay.truncated_body')
        : replayUiState.reason === 'closed'
          ? t('terminal.replay.closed_body')
        : t('terminal.replay.failed_body');
  }

  return (
    <div className="xterm-host-shell">
      <div
        ref={containerRef}
        className="xterm-host"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
        onFocusCapture={() => {
          if (isInteractive) {
            hydrationHandleRef.current?.promote('focused');
          }
        }}
        onMouseDown={() => {
          if (isInteractive) {
            hydrationHandleRef.current?.promote('focused');
          }
        }}
      />
      {uploadBusy ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            zIndex: 5,
            fontSize: 12,
            color: 'var(--text-muted, #ddd)',
          }}
        >
          Uploading…
        </div>
      ) : null}
      {viewport !== 'mobile' && hydrationState.kind === 'queued' ? (
        <XtermPlaceholder state="queued" queuePosition={hydrationState.queuePosition} />
      ) : null}
      {showReplayOverlay ? (
        <div className={replayClassName} role="status" aria-live="polite">
          <div className="xterm-replay-overlay__card">
            {replayUiState.kind === 'loading' ? <div className="xterm-replay-overlay__spinner" aria-hidden="true" /> : null}
            <div className="xterm-replay-overlay__title">{replayTitle}</div>
            {replayBody ? <div className="xterm-replay-overlay__body">{replayBody}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default XtermHost;
