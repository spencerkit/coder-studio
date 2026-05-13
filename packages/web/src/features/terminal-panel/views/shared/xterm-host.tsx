/**
 * XtermHost Component
 *
 * Renders xterm.js terminal with:
 * - FitAddon for responsive sizing
 * - WebSocket event subscription for output
 * - User input dispatch to server
 * - Aurora Mint theme that follows the current UI mode
 */

import { type TerminalInputActivity, Topics } from "@coder-studio/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { themeAtom } from "../../../../atoms/app-ui";
import { dispatchCommandAtom, wsClientAtom } from "../../../../atoms/connection";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { getThemeById } from "../../../../theme";
import type { ConnectionStatus, TerminalBinaryPayload } from "../../../../ws/client";
import { pushToastAtom } from "../../../notifications/atoms";
import type { OutputBuffer } from "../../atoms";
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from "../../atoms";
import {
  globalHydrationCoordinator,
  type HydrationRequestHandle,
  type HydrationTier,
} from "../../hydration-coordinator";
import { getLogicalLineTextFromTouchPoint } from "../../mobile/long-press-copy-line";
import { MobileTerminalInputBar } from "../../mobile/mobile-terminal-input-bar";
import {
  applyCtrlModeToInput,
  type CtrlMode,
  getSoftTerminalInputBytes,
  lockCtrlMode,
  type SoftTerminalKeyId,
  toggleCtrlMode,
} from "../../mobile/virtual-terminal-keys";
import { terminalPreferencesAtom } from "../../preferences";
import {
  classifyReplayFailure,
  TERMINAL_REPLAY_TIMEOUT_MS,
  type TerminalReplayUiState,
} from "../../replay-state";
import { usePasteDropUpload } from "../../uploads/use-paste-drop-upload";
import { XtermPlaceholder } from "./xterm-placeholder";

const MOBILE_TOUCH_SCROLL_FALLBACK_PX_PER_LINE = 16;
const MOBILE_TOUCH_MOMENTUM_SAMPLE_WINDOW_MS = 80;
const MOBILE_TOUCH_MOMENTUM_MIN_VELOCITY_PX_PER_MS = 0.12;
const MOBILE_TOUCH_MOMENTUM_STOP_VELOCITY_PX_PER_MS = 0.02;
const MOBILE_TOUCH_MOMENTUM_FRICTION_PER_FRAME = 0.92;
const MOBILE_TOUCH_MOMENTUM_FRAME_MS = 16;
const MOBILE_COPY_MODE_LONG_PRESS_MS = 500;
const MOBILE_COPY_MODE_MOVE_TOLERANCE_PX = 10;
const TERMINAL_FOCUS_REPORTING_BYTES = new Set(["\x1b[I", "\x1b[O"]);
const TERMINAL_COPY_ON_SELECT_ERROR_THROTTLE_MS = 3_000;

interface TerminalInputDraftState {
  nextDraft: string;
  submittedText?: string;
}

type TouchPointLike = Pick<Touch, "identifier" | "clientX" | "clientY" | "target">;

interface TouchScrollSample {
  clientY: number;
  at: number;
}

type TouchScrollDeltaResult = "idle" | "buffered" | "scrolled" | "blocked";

function isReplayGeneratedTerminalResponse(data: string): boolean {
  return /^\x1b\[\d+;\d+R$/.test(data) || /^\x1b\[(?:\?|>)(?:\d+;)*\d*c$/.test(data);
}

function classifyTerminalInput(data: string): TerminalInputActivity {
  if (TERMINAL_FOCUS_REPORTING_BYTES.has(data)) {
    return "system";
  }

  if (data.includes("\r") || data.includes("\n")) {
    return "submit";
  }

  return "typing";
}

function dropLastWordFromDraft(draft: string): string {
  let truncateIndex = draft.length;

  while (truncateIndex > 0) {
    const previousChar = draft[truncateIndex - 1];
    if (!previousChar || !/\s/.test(previousChar)) {
      break;
    }
    truncateIndex -= 1;
  }

  while (truncateIndex > 0) {
    const previousChar = draft[truncateIndex - 1];
    if (!previousChar || /\s/.test(previousChar)) {
      break;
    }
    truncateIndex -= 1;
  }

  return draft.slice(0, truncateIndex);
}

function consumeTerminalInputDraft(
  draft: string,
  data: string,
  activity: TerminalInputActivity
): TerminalInputDraftState {
  if (activity === "system") {
    return { nextDraft: draft };
  }

  let nextDraft = draft;
  let submittedText: string | undefined;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index]!;

    if (char === "\x1b") {
      const remaining = data.slice(index);
      const escapeMatch = remaining.match(
        /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\|[@-_])/
      );
      if (escapeMatch) {
        index += escapeMatch[0].length - 1;
        continue;
      }
    }

    if (char === "\u007f" || char === "\b") {
      nextDraft = nextDraft.slice(0, -1);
      continue;
    }

    if (char === "\u0015") {
      nextDraft = "";
      continue;
    }

    if (char === "\u0017") {
      nextDraft = dropLastWordFromDraft(nextDraft);
      continue;
    }

    if (char === "\u0003") {
      nextDraft = "";
      submittedText = undefined;
      continue;
    }

    if (char === "\r" || char === "\n") {
      submittedText = nextDraft.length > 0 ? nextDraft : submittedText;
      nextDraft = "";
      continue;
    }

    if (char >= " ") {
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

  if ("item" in list && typeof list.item === "function") {
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

function getTouchScrollPxPerLine(terminal: Terminal, container: HTMLElement): number {
  if (terminal.rows > 0) {
    const screenElement = terminal.element?.querySelector(".xterm-screen");
    const screenHeight =
      screenElement instanceof HTMLElement
        ? screenElement.getBoundingClientRect().height
        : container.getBoundingClientRect().height;

    if (screenHeight > 0) {
      return screenHeight / terminal.rows;
    }
  }

  return MOBILE_TOUCH_SCROLL_FALLBACK_PX_PER_LINE;
}

function shouldBypassPtyForKeyboardPaste(event: KeyboardEvent): boolean {
  if (event.type !== "keydown") {
    return false;
  }

  if (event.shiftKey || event.altKey) {
    return false;
  }

  const isPasteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
  return isPasteShortcut;
}

const terminalInputEncoder = new TextEncoder();
const terminalTraceDecoder = new TextDecoder("utf-8", { fatal: false });
const TERMINAL_TRACE_STORAGE_KEY = "coderStudio.terminalTrace";

function isTerminalTraceEnabled() {
  try {
    return globalThis.localStorage?.getItem(TERMINAL_TRACE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function waitForDocumentFontsReady(): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  const fontSet = document.fonts;
  if (!fontSet?.ready) {
    return Promise.resolve();
  }

  return fontSet.ready.then(
    () => undefined,
    () => undefined
  );
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function summarizeTerminalData(data: Uint8Array | string) {
  const text = typeof data === "string" ? data : terminalTraceDecoder.decode(data);
  return {
    length: typeof data === "string" ? data.length : data.byteLength,
    syncStart: countOccurrences(text, "\x1b[?2026h"),
    syncEnd: countOccurrences(text, "\x1b[?2026l"),
    clearToEnd: countOccurrences(text, "\x1b[J"),
    clearScreen: countOccurrences(text, "\x1b[2J"),
    eraseLine: countOccurrences(text, "\x1b[K"),
    cursorHome: countOccurrences(text, "\x1b[1;1H"),
    dsr: countOccurrences(text, "\x1b[6n"),
    da: countOccurrences(text, "\x1b[c"),
    reverseIndex: countOccurrences(text, "\x1bM"),
    cursorMoves: text.match(/\x1b\[[0-9;]*[Hf]/g)?.length ?? 0,
    scrollRegions: text.match(/\x1b\[[0-9;]*r/g)?.slice(0, 6) ?? [],
  };
}

function traceTerminal(terminalId: string, event: string, details: Record<string, unknown> = {}) {
  if (!isTerminalTraceEnabled()) {
    return;
  }

  console.debug("[terminal-trace]", {
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
  terminalKind?: "agent" | "shell";
  /** Container element ref for sizing */
  containerRef?: React.RefObject<HTMLDivElement>;
}

interface ReplayPayload {
  status: "ok" | "too_old" | "unknown";
  transport?: "binary";
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
  status: "ok" | "unsupported";
  transport?: "binary";
  streamId?: number;
  size?: number;
  seq?: number;
  rows?: number;
  cols?: number;
  source?: "headless";
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
  const terminalPreferences = useAtomValue(terminalPreferencesAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [outputAtom, setOutputAtom] = useAtom(terminalOutputAtomFamily(terminalId));
  const meta = useAtomValue(terminalMetaAtomFamily(terminalId));
  const terminalKind = terminalKindProp ?? meta?.kind ?? "shell";
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
  const coldStartStateRef = useRef<"idle" | "in-flight" | "done">("idle");
  const activeHistoricalRecoveryModeRef = useRef<"initial" | "reconnect" | null>(null);
  const latestRenderedSeqRef = useRef(0);
  const pendingRecoveryModeRef = useRef<"initial" | "reconnect" | null>(null);
  // Tracks whether xterm is currently processing replay data. While > 0,
  // handleInput suppresses only known terminal auto-responses (e.g. DSR
  // `\x1b[6n` → `\x1b[row;colR`) so real user keystrokes still reach the PTY.
  const replayWriteDepthRef = useRef(0);
  const replayWriteGenerationRef = useRef(0);
  const initialThemeRef = useRef(uiTheme);
  const inputDraftRef = useRef("");
  const inputRevisionRef = useRef(0);
  const hydrationHandleRef = useRef<HydrationRequestHandle | null>(null);
  const hydrationReleasedRef = useRef(false);
  const reconnectRecoveryTriggerRef = useRef<(() => void) | null>(null);
  const selectedTextRef = useRef("");
  const lastCopyOnSelectFailureAtRef = useRef(0);
  const copyOnSelectPointerIdRef = useRef<number | null>(null);
  const copyMobileLongPressRef = useRef<(lineText: string | null) => void>(() => {});
  const resetTouchStateRef = useRef<() => void>(() => {});
  const touchScrollStateRef = useRef<{
    activeTouchId: number | null;
    lastClientY: number;
    carryPx: number;
    pxPerLine: number | null;
    velocityPxPerMs: number;
    lastMomentumFrameAt: number;
    momentumFrameId: number | null;
    gestureDidScroll: boolean;
    samples: TouchScrollSample[];
  }>({
    activeTouchId: null,
    lastClientY: 0,
    carryPx: 0,
    pxPerLine: null,
    velocityPxPerMs: 0,
    lastMomentumFrameAt: 0,
    momentumFrameId: null,
    gestureDidScroll: false,
    samples: [],
  });

  const [replayUiState, setReplayUiState] = useState<TerminalReplayUiState>({ kind: "loading" });
  const [hydrationState, setHydrationState] = useState<
    { kind: "idle" } | { kind: "queued"; queuePosition: number } | { kind: "granted" }
  >(viewport === "mobile" ? { kind: "granted" } : { kind: "idle" });
  const [ctrlMode, setCtrlMode] = useState<CtrlMode>("off");
  const [shiftArmed, setShiftArmed] = useState(false);
  const ctrlModeRef = useRef<CtrlMode>("off");
  const shiftArmedRef = useRef(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => {
    if (!wsClient || typeof wsClient.getStatus !== "function") {
      return "disconnected";
    }

    return wsClient.getStatus();
  });

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
    if (viewport === "mobile") {
      setHydrationState({ kind: "granted" });
      hydrationReleasedRef.current = true;
      hydrationHandleRef.current = null;
      return;
    }

    hydrationReleasedRef.current = false;
    const tier: HydrationTier =
      meta?.alive === false ? "background" : isActiveSession ? "visible-active" : "visible-other";
    const handle = globalHydrationCoordinator.request({
      terminalId,
      tier,
    });
    hydrationHandleRef.current = handle;
    setHydrationState(handle.isGranted ? { kind: "granted" } : { kind: "idle" });

    let cancelled = false;
    const unsubscribe = handle.subscribePosition((queuePosition) => {
      if (!cancelled) {
        setHydrationState({ kind: "queued", queuePosition });
      }
    });

    if (!handle.isGranted) {
      void handle.granted.then(() => {
        if (!cancelled) {
          setHydrationState({ kind: "granted" });
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
    if (viewport === "mobile") {
      return;
    }

    const tier: HydrationTier =
      meta?.alive === false ? "background" : isActiveSession ? "visible-active" : "visible-other";
    hydrationHandleRef.current?.promote(tier);
  }, [isActiveSession, meta?.alive, viewport]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getThemeById(uiTheme).terminalTheme;
    }
  }, [uiTheme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    if (!window.matchMedia("(pointer: coarse)").matches) {
      return;
    }

    const state = touchScrollStateRef.current;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressTouchId: number | null = null;
    let longPressStartClientX = 0;
    let longPressStartClientY = 0;
    let longPressLineText: string | null = null;

    const clearLongPressTimer = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      longPressTouchId = null;
      longPressStartClientX = 0;
      longPressStartClientY = 0;
      longPressLineText = null;
    };

    const stopMomentumScroll = () => {
      if (state.momentumFrameId !== null) {
        cancelAnimationFrame(state.momentumFrameId);
        state.momentumFrameId = null;
      }
      state.velocityPxPerMs = 0;
      state.lastMomentumFrameAt = 0;
    };

    const recordTouchSample = (clientY: number, at: number) => {
      state.samples.push({ clientY, at });
      const oldestAllowedAt = at - MOBILE_TOUCH_MOMENTUM_SAMPLE_WINDOW_MS;
      while (state.samples.length > 0 && state.samples[0]!.at < oldestAllowedAt) {
        state.samples.shift();
      }
    };

    const updateVelocityFromSamples = () => {
      if (state.samples.length < 2) {
        state.velocityPxPerMs = 0;
        return;
      }

      const firstSample = state.samples[0]!;
      const lastSample = state.samples[state.samples.length - 1]!;
      const elapsedMs = lastSample.at - firstSample.at;
      if (elapsedMs <= 0) {
        state.velocityPxPerMs = 0;
        return;
      }

      state.velocityPxPerMs = (firstSample.clientY - lastSample.clientY) / elapsedMs;
    };

    const applyTouchScrollDelta = (terminal: Terminal, deltaPx: number): TouchScrollDeltaResult => {
      const base = terminal.buffer.active.baseY;
      if (base <= 0) {
        state.carryPx = 0;
        return "blocked";
      }

      state.carryPx += deltaPx;
      const pxPerLine =
        state.pxPerLine ?? (state.pxPerLine = getTouchScrollPxPerLine(terminal, container));
      const scrollLines =
        state.carryPx > 0
          ? Math.floor(state.carryPx / pxPerLine)
          : Math.ceil(state.carryPx / pxPerLine);

      if (scrollLines === 0) {
        return "buffered";
      }

      const viewport = terminal.buffer.active.viewportY;
      const remainingScrollback = base - viewport;
      const allowedScrollLines =
        scrollLines > 0
          ? Math.min(scrollLines, remainingScrollback)
          : Math.max(scrollLines, -viewport);

      if (allowedScrollLines === 0) {
        state.carryPx = 0;
        return "blocked";
      }

      terminal.scrollLines(allowedScrollLines);
      state.carryPx -= allowedScrollLines * pxPerLine;
      return "scrolled";
    };

    const stepMomentumScroll = (frameAt: number) => {
      if (state.momentumFrameId === null) {
        return;
      }

      const terminal = terminalRef.current;
      if (!terminal) {
        stopMomentumScroll();
        return;
      }

      const previousFrameAt =
        state.lastMomentumFrameAt > 0
          ? state.lastMomentumFrameAt
          : frameAt - MOBILE_TOUCH_MOMENTUM_FRAME_MS;
      const elapsedMs = Math.max(1, Math.min(64, frameAt - previousFrameAt));
      state.lastMomentumFrameAt = frameAt;

      const scrollResult = applyTouchScrollDelta(terminal, state.velocityPxPerMs * elapsedMs);
      const frameFriction = Math.pow(
        MOBILE_TOUCH_MOMENTUM_FRICTION_PER_FRAME,
        elapsedMs / MOBILE_TOUCH_MOMENTUM_FRAME_MS
      );
      state.velocityPxPerMs *= frameFriction;

      if (
        scrollResult === "blocked" ||
        Math.abs(state.velocityPxPerMs) <= MOBILE_TOUCH_MOMENTUM_STOP_VELOCITY_PX_PER_MS
      ) {
        state.carryPx = 0;
        stopMomentumScroll();
        state.pxPerLine = null;
        return;
      }

      state.momentumFrameId = requestAnimationFrame(stepMomentumScroll);
    };

    const resetTouchState = () => {
      clearLongPressTimer();
      stopMomentumScroll();
      state.activeTouchId = null;
      state.lastClientY = 0;
      state.carryPx = 0;
      state.pxPerLine = null;
      state.gestureDidScroll = false;
      state.samples = [];
    };

    resetTouchStateRef.current = resetTouchState;

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

      stopMomentumScroll();
      state.activeTouchId = touch.identifier;
      state.lastClientY = touch.clientY;
      state.carryPx = 0;
      state.pxPerLine = terminalRef.current
        ? getTouchScrollPxPerLine(terminalRef.current, container)
        : MOBILE_TOUCH_SCROLL_FALLBACK_PX_PER_LINE;
      state.gestureDidScroll = false;
      state.samples = [];
      recordTouchSample(touch.clientY, performance.now());
      if (viewport === "mobile" && terminalPreferences.copyOnSelect) {
        longPressTouchId = touch.identifier;
        longPressStartClientX = touch.clientX;
        longPressStartClientY = touch.clientY;
        const terminal = terminalRef.current;
        const rowsElement = container.querySelector(".xterm-rows");
        longPressLineText =
          terminal && rowsElement instanceof HTMLElement
            ? getLogicalLineTextFromTouchPoint({
                clientX: touch.clientX,
                clientY: touch.clientY,
                rowsElement,
                terminal,
              })
            : null;
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const lineText = longPressLineText;
          clearLongPressTimer();
          state.activeTouchId = null;
          state.lastClientY = 0;
          state.carryPx = 0;
          state.pxPerLine = null;
          state.velocityPxPerMs = 0;
          state.samples = [];
          copyMobileLongPressRef.current(lineText);
        }, MOBILE_COPY_MODE_LONG_PRESS_MS);
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = findTouchByIdentifier(event.changedTouches, state.activeTouchId);
      const terminal = terminalRef.current;
      if (!touch || !terminal) {
        return;
      }

      if (longPressTouchId === touch.identifier) {
        if (
          Math.abs(touch.clientX - longPressStartClientX) > MOBILE_COPY_MODE_MOVE_TOLERANCE_PX ||
          Math.abs(touch.clientY - longPressStartClientY) > MOBILE_COPY_MODE_MOVE_TOLERANCE_PX
        ) {
          clearLongPressTimer();
        } else {
          return;
        }
      }

      const base = terminal.buffer.active.baseY;
      if (base <= 0) {
        state.lastClientY = touch.clientY;
        state.carryPx = 0;
        state.gestureDidScroll = false;
        state.samples = [];
        state.velocityPxPerMs = 0;
        return;
      }

      state.gestureDidScroll = true;
      const deltaY = state.lastClientY - touch.clientY;
      state.lastClientY = touch.clientY;
      recordTouchSample(touch.clientY, performance.now());
      updateVelocityFromSamples();

      const scrollResult = applyTouchScrollDelta(terminal, deltaY);
      if ((scrollResult === "buffered" || scrollResult === "scrolled") && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (findTouchByIdentifier(event.changedTouches, longPressTouchId)) {
        clearLongPressTimer();
      }

      if (findTouchByIdentifier(event.changedTouches, state.activeTouchId)) {
        const canStartMomentum = state.gestureDidScroll;
        const touch = findTouchByIdentifier(event.changedTouches, state.activeTouchId);
        if (touch && canStartMomentum) {
          recordTouchSample(touch.clientY, performance.now());
          updateVelocityFromSamples();
        }

        state.activeTouchId = null;
        state.lastClientY = 0;
        state.gestureDidScroll = false;
        state.samples = [];

        if (
          canStartMomentum &&
          Math.abs(state.velocityPxPerMs) >= MOBILE_TOUCH_MOMENTUM_MIN_VELOCITY_PX_PER_MS
        ) {
          state.lastMomentumFrameAt = 0;
          state.momentumFrameId = requestAnimationFrame(stepMomentumScroll);
          return;
        }

        state.carryPx = 0;
        state.pxPerLine = null;
        state.velocityPxPerMs = 0;
      }
    };

    const handleTouchCancel = () => {
      resetTouchState();
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
      resetTouchStateRef.current = () => {};
      resetTouchState();
    };
  }, [terminalPreferences.copyOnSelect, viewport]);

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
        traceTerminal(terminalId, "fit", { before, after });
      } catch (error) {
        console.error("Failed to fit xterm instance:", error);
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

  const updateCtrlMode = useCallback((nextCtrlMode: CtrlMode) => {
    ctrlModeRef.current = nextCtrlMode;
    setCtrlMode(nextCtrlMode);
  }, []);

  const updateShiftArmed = useCallback((nextShiftArmed: boolean) => {
    shiftArmedRef.current = nextShiftArmed;
    setShiftArmed(nextShiftArmed);
  }, []);

  const pushCopyOnSelectFailureToast = useCallback(() => {
    const now = Date.now();
    if (now - lastCopyOnSelectFailureAtRef.current < TERMINAL_COPY_ON_SELECT_ERROR_THROTTLE_MS) {
      return;
    }

    lastCopyOnSelectFailureAtRef.current = now;
    pushToast({
      kind: "error",
      title:
        viewport === "mobile"
          ? t("terminal.mobile_copy_current_line_failed_title")
          : t("settings.copy_on_select_failed_title"),
      body:
        viewport === "mobile"
          ? t("terminal.mobile_copy_current_line_failed_body")
          : t("settings.copy_on_select_failed_body"),
    });
  }, [pushToast, t, viewport]);

  const copyMobileLongPress = useCallback(
    async (lineText: string | null) => {
      if (viewport !== "mobile" || !terminalPreferences.copyOnSelect) {
        return;
      }

      resetTouchStateRef.current();
      if (lineText === null) {
        return;
      }

      try {
        await navigator.clipboard.writeText(lineText);
        pushToast({
          kind: "success",
          title: t("terminal.copied_current_line"),
        });
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(10);
        }
      } catch {
        pushCopyOnSelectFailureToast();
      }
    },
    [pushCopyOnSelectFailureToast, pushToast, t, terminalPreferences.copyOnSelect, viewport]
  );

  useEffect(() => {
    copyMobileLongPressRef.current = (lineText) => {
      void copyMobileLongPress(lineText);
    };
  }, [copyMobileLongPress]);

  useLayoutEffect(() => {
    resetTouchStateRef.current();
  }, [terminalId, workspaceId]);

  const copySelectionOnSelect = useCallback(async () => {
    if (viewport === "mobile" || !terminalPreferences.copyOnSelect) {
      return;
    }

    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) {
      return;
    }

    const selection = selectedTextRef.current || terminal.getSelection();
    if (!selection) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selection);
    } catch {
      pushCopyOnSelectFailureToast();
    }
  }, [pushCopyOnSelectFailureToast, terminalPreferences.copyOnSelect, viewport]);

  /**
   * Handle user input - dispatch to server
   */
  const handleInput = useCallback(
    async (data: string, activityOverride?: TerminalInputActivity) => {
      if (replayWriteDepthRef.current > 0 && isReplayGeneratedTerminalResponse(data)) {
        traceTerminal(terminalId, "input.suppressed-replay-response", {
          summary: summarizeTerminalData(data),
        });
        return;
      }

      if (!interactiveRef.current) {
        return;
      }

      if (!wsClient) {
        console.error("Cannot send terminal input: WebSocket not connected");
        return;
      }

      const inputRevision = inputRevisionRef.current + 1;
      inputRevisionRef.current = inputRevision;
      const previousCtrlMode = ctrlModeRef.current;
      const previousDraft = inputDraftRef.current;
      const normalized = applyCtrlModeToInput(data, previousCtrlMode);
      const activity =
        normalized.activity ?? activityOverride ?? classifyTerminalInput(normalized.data);
      const { nextDraft, submittedText } = consumeTerminalInputDraft(
        previousDraft,
        normalized.data,
        activity
      );

      try {
        if (normalized.nextCtrlMode !== previousCtrlMode) {
          updateCtrlMode(normalized.nextCtrlMode);
        }

        traceTerminal(terminalId, "input", {
          activity,
          summary: summarizeTerminalData(normalized.data),
        });
        inputDraftRef.current = nextDraft;

        await wsClient.sendTerminalInput(
          terminalId,
          terminalInputEncoder.encode(normalized.data),
          activity,
          submittedText
        );
      } catch (error) {
        if (inputRevisionRef.current === inputRevision) {
          inputDraftRef.current = previousDraft;
          if (
            normalized.nextCtrlMode !== previousCtrlMode &&
            ctrlModeRef.current === normalized.nextCtrlMode
          ) {
            updateCtrlMode(previousCtrlMode);
          }
        }
        console.error("Failed to send terminal input:", error);
      }
    },
    [terminalId, updateCtrlMode, wsClient]
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
      traceTerminal(terminalId, "resize.dispatch", {
        previousSize,
        nextSize: { cols, rows },
      });

      const result = await dispatch("terminal.resize", {
        terminalId,
        cols,
        rows,
      });

      if (!result.ok) {
        console.error("Failed to sync terminal size:", result.error);
      }
      traceTerminal(terminalId, "resize.result", {
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

  useEffect(() => {
    if (!wsClient) {
      setConnectionStatus("disconnected");
      return;
    }

    if (typeof wsClient.getStatus === "function") {
      setConnectionStatus(wsClient.getStatus());
    } else {
      setConnectionStatus("connected");
    }

    if (typeof wsClient.onStatus !== "function") {
      return;
    }

    return wsClient.onStatus((status) => {
      setConnectionStatus(status);
    });
  }, [wsClient]);

  useLayoutEffect(() => {
    updateCtrlMode("off");
    updateShiftArmed(false);
    inputDraftRef.current = "";
    inputRevisionRef.current += 1;
  }, [terminalId, updateCtrlMode, updateShiftArmed]);

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
    if (viewport !== "mobile" && hydrationState.kind !== "granted") {
      return;
    }

    if (!containerRef.current) return;

    let disposed = false;
    let unsubscribeStatus: (() => void) | null = null;
    const replayWriteGeneration = replayWriteGenerationRef.current + 1;

    replayWriteGenerationRef.current = replayWriteGeneration;
    replayWriteDepthRef.current = 0;
    reconnectRecoveryTriggerRef.current = null;
    pendingRecoveryModeRef.current = null;

    replayCompletedRef.current = false;
    replayedSeqRef.current = 0;
    coldStartStateRef.current = "idle";
    activeHistoricalRecoveryModeRef.current = null;
    pendingReplayChunksRef.current = [];
    lastReportedSizeRef.current = null;
    setReplayUiState({ kind: "loading" });

    // Create Terminal instance.
    // lineHeight is left at xterm.js default (1.0) so that box-drawing
    // characters used by TUIs (claude, codex) render as a continuous frame
    // with no gaps between rows.
    const terminal = new Terminal({
      theme: getThemeById(initialThemeRef.current).terminalTheme,
      fontFamily: "JetBrains Mono, Fira Code, SF Mono, monospace",
      fontSize: 11,
      scrollback: 5000,
      cursorBlink: isInteractive && !uploadBusy,
      cursorStyle: "block",
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
    const selectionChangeDisposable =
      typeof terminal.onSelectionChange === "function"
        ? terminal.onSelectionChange(() => {
            selectedTextRef.current = terminal.hasSelection() ? terminal.getSelection() : "";
          })
        : undefined;
    terminal.attachCustomKeyEventHandler((event) => !shouldBypassPtyForKeyboardPaste(event));

    terminal.open(containerRef.current);
    traceTerminal(terminalId, "mount.open");
    // Defer the first fit to the next frame so flex layout has settled;
    // calling fit() synchronously right after open() sometimes runs against a
    // zero- or partial-height container and produces an off-by-one row count
    // whose leftover pixels render as a blank strip.
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();
    const initialFitReady = waitForNextFit();
    if (viewport !== "mobile") {
      void initialFitReady
        .then(async () => {
          await waitForDocumentFontsReady();
          if (disposed || !mountedRef.current) {
            return;
          }

          scheduleFit();
        })
        .catch(() => {
          // Keep the initial terminal boot resilient even if the Font Loading
          // API is unavailable or a browser rejects the readiness promise.
        });
    }

    const waitForConnected = async () => {
      if (!wsClient) {
        return;
      }

      if (typeof wsClient.getStatus !== "function" || typeof wsClient.onStatus !== "function") {
        return;
      }

      if (wsClient.getStatus() === "connected") {
        return;
      }

      await new Promise<void>((resolve) => {
        let resolved = false;
        const resolveConnected = () => {
          if (resolved) {
            return;
          }
          resolved = true;
          unsubscribeStatus?.();
          unsubscribeStatus = null;
          resolve();
        };

        unsubscribeStatus = wsClient.onStatus((status) => {
          if (status === "connected") {
            resolveConnected();
          }
        });

        // Close the getStatus/onStatus race: the socket may connect after the
        // pre-check above but before the listener is fully installed.
        if (wsClient.getStatus() === "connected") {
          resolveConnected();
        }
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
    const writeReplayBytes = (bytes: Uint8Array, onRendered?: () => void) => {
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
        onRendered?.();
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

    const collectPendingReplayChunks = (coveredSeq: number) => {
      const pending = pendingReplayChunksRef.current;
      pendingReplayChunksRef.current = [];

      const entries: Array<{ bytes: Uint8Array; seq: number }> = [];
      let latestCoveredSeq = coveredSeq;
      for (const entry of pending) {
        if (entry.seq <= latestCoveredSeq) {
          continue;
        }

        entries.push(entry);
        latestCoveredSeq = entry.seq;
      }

      return {
        entries,
        latestCoveredSeq,
      };
    };

    const finalizeHistoricalRecovery = (completedRecoveryMode: "initial" | "reconnect" | null) => {
      coldStartStateRef.current = "done";
      activeHistoricalRecoveryModeRef.current = null;
      if (completedRecoveryMode && pendingRecoveryModeRef.current === completedRecoveryMode) {
        pendingRecoveryModeRef.current = "reconnect";
      }
      reconnectRecoveryTriggerRef.current?.();
    };

    const queueHistoricalWrites = (
      completedRecoveryMode: "initial" | "reconnect" | null,
      coveredSeq: number,
      writes: Array<{
        kind: "historical" | "pending";
        bytes: Uint8Array;
        seq: number;
        resetTerminalBeforeWrite?: boolean;
      }>
    ) => {
      replayedSeqRef.current = coveredSeq;
      replayCompletedRef.current = true;

      if (writes.length === 0) {
        latestRenderedSeqRef.current = Math.max(latestRenderedSeqRef.current, coveredSeq);
        finalizeHistoricalRecovery(completedRecoveryMode);
        return;
      }

      let pendingWriteCount = writes.length;
      const markWriteRendered = (seq: number) => {
        if (!mountedRef.current || replayWriteGenerationRef.current !== replayWriteGeneration) {
          return;
        }

        latestRenderedSeqRef.current = Math.max(latestRenderedSeqRef.current, seq);
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        if (pendingWriteCount === 0) {
          finalizeHistoricalRecovery(completedRecoveryMode);
        }
      };

      for (const write of writes) {
        if (write.resetTerminalBeforeWrite && typeof terminalRef.current?.reset === "function") {
          terminalRef.current.reset();
        }

        if (write.kind === "historical") {
          traceTerminal(terminalId, "write.historical", {
            seq: write.seq,
            size: write.bytes.byteLength,
            summary: summarizeTerminalData(write.bytes),
          });
        } else {
          traceTerminal(terminalId, "write.pending-replay-chunk", {
            seq: write.seq,
            summary: summarizeTerminalData(write.bytes),
          });
        }

        if (write.kind === "historical") {
          writeReplayBytes(write.bytes, () => {
            markWriteRendered(write.seq);
          });
          continue;
        }

        // Chunks buffered while the snapshot/replay baseline was loading are
        // still live PTY output and must keep xterm auto-responses enabled.
        terminal.write(write.bytes, () => {
          markWriteRendered(write.seq);
        });
      }
    };

    const finishHistoricalLoad = (
      result: ReplayCommandResult | null,
      options: {
        successStatus: "ok";
        successBytes: Uint8Array | undefined;
        coveredSeq: number | undefined;
        resetTerminalBeforeWrite?: boolean;
      }
    ) => {
      if (!mountedRef.current || !terminalRef.current || !result) {
        return;
      }

      const completedRecoveryMode = activeHistoricalRecoveryModeRef.current;
      let coveredSeq = replayedSeqRef.current;
      const writes: Array<{
        kind: "historical" | "pending";
        bytes: Uint8Array;
        seq: number;
        resetTerminalBeforeWrite?: boolean;
      }> = [];
      if (result.ok && result.data?.status === options.successStatus) {
        if (options.successBytes) {
          writes.push({
            kind: "historical",
            bytes: options.successBytes,
            seq: options.coveredSeq ?? coveredSeq,
            resetTerminalBeforeWrite: options.resetTerminalBeforeWrite,
          });
        }
        coveredSeq = options.coveredSeq ?? coveredSeq;
        setReplayUiState({ kind: "ready" });
        if (viewport !== "mobile") {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (result.data?.status === "too_old") {
        // Ring buffer overflow - show a message to the user
        if (terminalRef.current) {
          terminalRef.current.writeln(
            "\r\n\x1b[33m[Session history truncated - output exceeds buffer size]\x1b[0m"
          );
        }
        setReplayUiState({ kind: "degraded", reason: "truncated" });
        if (viewport !== "mobile") {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (result.data?.status === "unknown") {
        setReplayUiState({ kind: "degraded", reason: "closed" });
        if (viewport !== "mobile") {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      } else if (!result.ok) {
        console.error("Failed to replay terminal output:", result.error);
        setReplayUiState({ kind: "degraded", reason: classifyReplayFailure(result.error) });
        if (viewport !== "mobile") {
          hydrationHandleRef.current?.release();
          hydrationReleasedRef.current = true;
        }
      }

      const { entries: pendingWrites, latestCoveredSeq } = collectPendingReplayChunks(coveredSeq);
      coveredSeq = latestCoveredSeq;
      for (const entry of pendingWrites) {
        writes.push({
          kind: "pending",
          bytes: entry.bytes,
          seq: entry.seq,
        });
      }

      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
        lastSeq: Math.max(prev.lastSeq, coveredSeq),
      }));

      queueHistoricalWrites(completedRecoveryMode, coveredSeq, writes);
    };

    const finishReplay = (result: ReplayCommandResult | null) => {
      finishHistoricalLoad(result, {
        successStatus: "ok",
        successBytes: result?.data?.bytes,
        coveredSeq: result?.data?.seq,
      });
    };

    const failHistoricalRecovery = (error: unknown) => {
      console.error("Failed to recover terminal output:", error);
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      const completedRecoveryMode = activeHistoricalRecoveryModeRef.current;
      setReplayUiState({ kind: "degraded", reason: classifyReplayFailure(error) });
      if (viewport !== "mobile") {
        hydrationHandleRef.current?.release();
        hydrationReleasedRef.current = true;
      }

      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
        lastSeq: Math.max(prev.lastSeq, replayedSeqRef.current),
      }));

      const { entries: pendingWrites, latestCoveredSeq } = collectPendingReplayChunks(
        replayedSeqRef.current
      );
      queueHistoricalWrites(
        completedRecoveryMode,
        latestCoveredSeq,
        pendingWrites.map((entry) => ({
          kind: "pending" as const,
          bytes: entry.bytes,
          seq: entry.seq,
        }))
      );
    };

    const requestSnapshot = (options?: {
      resetTerminalBeforeWrite?: boolean;
      onUnavailable?: (result: SnapshotCommandResult) => void;
    }) => {
      if (!wsClient) {
        return;
      }

      coldStartStateRef.current = "in-flight";
      replayCompletedRef.current = false;
      setReplayUiState({ kind: "loading" });

      const snapshotPromise: Promise<SnapshotCommandResult> = wsClient
        .sendCommand<TerminalSnapshotPayload>(
          "terminal.snapshot",
          { terminalId },
          { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
        )
        .then((data) => ({ ok: true as const, data }))
        .catch((error) => ({ ok: false as const, error }));

      void snapshotPromise.then((result) => {
        if (!mountedRef.current || !terminalRef.current) {
          return;
        }

        if (
          result.ok &&
          result.data?.status === "ok" &&
          result.data.bytes &&
          typeof result.data.seq === "number"
        ) {
          finishHistoricalLoad(result, {
            successStatus: "ok",
            successBytes: result.data.bytes,
            coveredSeq: result.data.seq,
            resetTerminalBeforeWrite: options?.resetTerminalBeforeWrite,
          });
          return;
        }

        if (options?.onUnavailable) {
          options.onUnavailable(result);
          return;
        }

        failHistoricalRecovery(
          result.ok
            ? new Error(`terminal.snapshot returned status ${result.data?.status ?? "unknown"}`)
            : result.error
        );
      });
    };

    const requestReplay = (
      lastSeq: number,
      options?: {
        onTooOld?: () => void;
        onError?: (error: unknown) => void;
      }
    ) => {
      if (!wsClient) {
        return;
      }
      coldStartStateRef.current = "in-flight";
      replayCompletedRef.current = false;
      if (lastSeq === 0) {
        setReplayUiState({ kind: "loading" });
      }
      traceTerminal(terminalId, "replay.request", { lastSeq });

      const replayPromise: Promise<ReplayCommandResult> = wsClient
        ? wsClient
            .sendCommand<ReplayPayload>(
              "terminal.replay",
              { terminalId, lastSeq },
              { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
            )
            .then((data) => ({ ok: true as const, data }))
        : dispatch<ReplayPayload>("terminal.replay", { terminalId, lastSeq });

      void replayPromise
        .then((result) => {
          if (result.ok && result.data?.status === "too_old" && options?.onTooOld) {
            options.onTooOld();
            return;
          }
          finishReplay(result);
        })
        .catch((error) => {
          if (options?.onError) {
            options.onError(error);
            return;
          }
          failHistoricalRecovery(error);
        });
    };

    const deferRecoveryUntilReconnect = () => {
      if (!pendingRecoveryModeRef.current) {
        pendingRecoveryModeRef.current = activeHistoricalRecoveryModeRef.current ?? "reconnect";
      }
      coldStartStateRef.current = "idle";
      activeHistoricalRecoveryModeRef.current = null;
      replayCompletedRef.current = false;
      reconnectRecoveryTriggerRef.current?.();
    };

    const getConnectionStatus = (): ConnectionStatus =>
      typeof wsClient.getStatus === "function" ? wsClient.getStatus() : "connected";

    const requestReconnectSnapshotFallback = (reason: "too_old" | "error", error?: unknown) => {
      const connectionStatus = getConnectionStatus();
      if (
        pendingRecoveryModeRef.current === "reconnect" ||
        connectionStatus === "disconnected" ||
        connectionStatus === "reconnecting"
      ) {
        traceTerminal(terminalId, "reconnect.snapshot-fallback.defer-until-reconnect", {
          lastSeq: latestRenderedSeqRef.current,
          reason,
          error: error ? String(error) : undefined,
          connectionStatus,
        });
        deferRecoveryUntilReconnect();
        return;
      }

      traceTerminal(terminalId, "reconnect.snapshot-fallback", {
        lastSeq: latestRenderedSeqRef.current,
        reason,
        error: error ? String(error) : undefined,
      });
      requestSnapshot({
        resetTerminalBeforeWrite: true,
        onUnavailable: (result) => {
          const snapshotConnectionStatus = getConnectionStatus();
          if (
            pendingRecoveryModeRef.current === "reconnect" ||
            snapshotConnectionStatus === "disconnected" ||
            snapshotConnectionStatus === "reconnecting"
          ) {
            traceTerminal(terminalId, "reconnect.snapshot.defer-until-reconnect", {
              reason: result.ok ? (result.data?.status ?? "unsupported") : String(result.error),
              connectionStatus: snapshotConnectionStatus,
            });
            deferRecoveryUntilReconnect();
            return;
          }

          failHistoricalRecovery(
            result.ok
              ? new Error(`terminal.snapshot returned status ${result.data?.status ?? "unknown"}`)
              : result.error
          );
        },
      });
    };

    const requestHistoricalRecovery = (mode: "initial" | "reconnect") => {
      if (!wsClient) {
        return;
      }

      activeHistoricalRecoveryModeRef.current = mode;

      if (mode === "reconnect") {
        setReplayUiState({ kind: "loading" });
        requestReplay(latestRenderedSeqRef.current, {
          onTooOld: () => {
            requestReconnectSnapshotFallback("too_old");
          },
          onError: (error) => {
            requestReconnectSnapshotFallback("error", error);
          },
        });
        return;
      }

      requestSnapshot({
        onUnavailable: (result) => {
          const connectionStatus = getConnectionStatus();
          if (
            pendingRecoveryModeRef.current === "initial" ||
            connectionStatus === "disconnected" ||
            connectionStatus === "reconnecting"
          ) {
            traceTerminal(terminalId, "snapshot.defer-until-reconnect", {
              reason: result.ok ? (result.data?.status ?? "unsupported") : String(result.error),
              connectionStatus,
            });
            deferRecoveryUntilReconnect();
            return;
          }

          traceTerminal(terminalId, "snapshot.fallback", {
            reason: result.ok ? (result.data?.status ?? "unsupported") : String(result.error),
          });
          requestReplay(0);
        },
      });
    };

    reconnectRecoveryTriggerRef.current = () => {
      if (!pendingRecoveryModeRef.current) {
        return;
      }

      if (typeof wsClient.getStatus === "function" && wsClient.getStatus() !== "connected") {
        return;
      }

      if (coldStartStateRef.current === "in-flight") {
        return;
      }

      const recoveryMode = pendingRecoveryModeRef.current;
      pendingRecoveryModeRef.current = null;
      requestHistoricalRecovery(recoveryMode);
    };

    if (wsClient) {
      unsubscribeRef.current = wsClient.subscribe(
        [outputTopic, exitTopic],
        (topic, payload, _seq) => {
          if (topic === outputTopic) {
            const outputData = payload as TerminalBinaryPayload;
            traceTerminal(terminalId, "live.output", {
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
              traceTerminal(terminalId, "live.drop-covered", {
                seq: _seq,
                replayedSeq: replayedSeqRef.current,
              });
              return;
            }

            const chunkStartSeq = _seq - outputData.bytes.byteLength;
            if (chunkStartSeq > replayedSeqRef.current) {
              traceTerminal(terminalId, "live.gap", {
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

      requestHistoricalRecovery("initial");
    })().catch((error) => {
      failHistoricalRecovery(error);
    });

    return () => {
      disposed = true;
      reconnectRecoveryTriggerRef.current = null;
      pendingRecoveryModeRef.current = null;
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
          console.error("Failed to dispose xterm instance:", error);
        }
        terminalRef.current = null;
        fitAddonRef.current = null;
      }
      if (typeof selectionChangeDisposable === "function") {
        selectionChangeDisposable();
      } else {
        selectionChangeDisposable?.dispose?.();
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
    const container = containerRef.current;
    if (
      !container ||
      typeof document === "undefined" ||
      viewport === "mobile" ||
      !terminalPreferences.copyOnSelect
    ) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        return;
      }

      copyOnSelectPointerIdRef.current = event.pointerId;
    };

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        return;
      }

      const pressTarget = event.target;
      if (pressTarget instanceof Node && container.contains(pressTarget)) {
        return;
      }

      if (copyOnSelectPointerIdRef.current === event.pointerId) {
        copyOnSelectPointerIdRef.current = null;
      }
    };

    const clearTrackedPointer = (event: PointerEvent) => {
      if (copyOnSelectPointerIdRef.current === event.pointerId) {
        copyOnSelectPointerIdRef.current = null;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        return;
      }

      const releaseTarget = event.target;
      const releasedInsideHost = releaseTarget instanceof Node && container.contains(releaseTarget);
      const releasedTrackedPointer =
        copyOnSelectPointerIdRef.current !== null &&
        copyOnSelectPointerIdRef.current === event.pointerId;

      copyOnSelectPointerIdRef.current = null;
      if (!releasedInsideHost && !releasedTrackedPointer) {
        return;
      }

      void copySelectionOnSelect();
    };

    container.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", clearTrackedPointer);
    return () => {
      copyOnSelectPointerIdRef.current = null;
      container.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", clearTrackedPointer);
    };
  }, [copySelectionOnSelect, terminalPreferences.copyOnSelect, viewport]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.onStatus !== "function") {
      return;
    }

    const unsubscribe = wsClient.onStatus((status) => {
      if (status === "disconnected" || status === "reconnecting") {
        if (coldStartStateRef.current !== "idle") {
          const recoveryMode = activeHistoricalRecoveryModeRef.current ?? "reconnect";
          pendingRecoveryModeRef.current = recoveryMode;
        }
        return;
      }

      if (status !== "connected" || !pendingRecoveryModeRef.current) {
        return;
      }

      reconnectRecoveryTriggerRef.current?.();
    });

    return unsubscribe;
  }, [wsClient]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.onRecovery !== "function") {
      return;
    }

    return wsClient.onRecovery((trigger) => {
      if (trigger === "reconnected") {
        return;
      }

      pendingRecoveryModeRef.current = "reconnect";

      if (coldStartStateRef.current === "in-flight") {
        return;
      }

      reconnectRecoveryTriggerRef.current?.();
    });
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

        traceTerminal(terminalId, "write.live-buffer", {
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
      traceTerminal(terminalId, "resize-observer", {
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
  }, [hydrationState.kind, scheduleFit, terminalId]);

  /**
   * Focus terminal when it becomes active
   */
  useEffect(() => {
    if (
      viewport !== "mobile" &&
      hydrationState.kind === "granted" &&
      meta?.alive &&
      terminalRef.current
    ) {
      terminalRef.current.focus();
    }
  }, [hydrationState.kind, meta?.alive, viewport]);

  const showMobileInputBar = viewport === "mobile" && isInteractive;
  const mobileInputDisabled = !isInteractive || uploadBusy || connectionStatus !== "connected";
  const mobileInputLabels = {
    shortcuts: t("terminal.mobile_input.shortcuts"),
    ctrl: t("terminal.mobile_input.ctrl"),
    ctrlArmed: t("terminal.mobile_input.ctrl_armed"),
    ctrlLocked: t("terminal.mobile_input.ctrl_locked"),
    shift: t("terminal.mobile_input.shift"),
    shiftArmed: t("terminal.mobile_input.shift_armed"),
    escape: t("terminal.mobile_input.escape"),
    tab: t("terminal.mobile_input.tab"),
    enter: t("terminal.mobile_input.enter"),
    up: t("terminal.mobile_input.up"),
    down: t("terminal.mobile_input.down"),
    left: t("terminal.mobile_input.left"),
    right: t("terminal.mobile_input.right"),
  };

  const handleSoftKeyPress = useCallback(
    async (key: SoftTerminalKeyId) => {
      const nextShiftArmed = shiftArmedRef.current;
      if (nextShiftArmed) {
        updateShiftArmed(false);
      }
      await handleInput(getSoftTerminalInputBytes(key, { shift: nextShiftArmed }));
    },
    [handleInput, updateShiftArmed]
  );

  const handleCtrlTap = useCallback(() => {
    updateCtrlMode(toggleCtrlMode(ctrlModeRef.current));
  }, [updateCtrlMode]);

  const handleCtrlLongPress = useCallback(() => {
    updateCtrlMode(lockCtrlMode());
  }, [updateCtrlMode]);

  const handleShiftTap = useCallback(() => {
    updateShiftArmed(!shiftArmedRef.current);
  }, [updateShiftArmed]);

  const showReplayOverlay =
    replayUiState.kind !== "ready" && (viewport === "mobile" || hydrationState.kind === "granted");

  let replayTitle = "";
  let replayBody = "";
  let replayClassName = "xterm-replay-overlay";

  if (replayUiState.kind === "loading") {
    replayTitle = t("terminal.replay.loading_title");
    replayBody = t("terminal.replay.loading_body");
  } else {
    replayClassName += " xterm-replay-overlay--degraded";
    replayTitle =
      replayUiState.reason === "truncated"
        ? t("terminal.replay.truncated_title")
        : replayUiState.reason === "closed"
          ? t("terminal.replay.closed_title")
          : t("terminal.replay.failed_title");
    replayBody =
      replayUiState.reason === "truncated"
        ? t("terminal.replay.truncated_body")
        : replayUiState.reason === "closed"
          ? t("terminal.replay.closed_body")
          : t("terminal.replay.failed_body");
  }

  return (
    <div
      className={`xterm-host-shell${showMobileInputBar ? " xterm-host-shell--mobile-input" : ""}`}
    >
      {showMobileInputBar ? (
        <MobileTerminalInputBar
          ctrlMode={ctrlMode}
          shiftArmed={shiftArmed}
          disabled={mobileInputDisabled}
          labels={mobileInputLabels}
          onKeyPress={(key) => {
            void handleSoftKeyPress(key);
          }}
          onCtrlTap={handleCtrlTap}
          onCtrlLongPress={handleCtrlLongPress}
          onShiftTap={handleShiftTap}
        />
      ) : null}
      <div
        ref={containerRef}
        className="xterm-host"
        style={{
          width: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
        onFocusCapture={() => {
          if (isInteractive) {
            hydrationHandleRef.current?.promote("focused");
          }
        }}
        onMouseDown={() => {
          if (isInteractive) {
            hydrationHandleRef.current?.promote("focused");
          }
        }}
      />
      {uploadBusy ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.35)",
            pointerEvents: "none",
            zIndex: 5,
            fontSize: 12,
            color: "var(--text-muted, #ddd)",
          }}
        >
          Uploading…
        </div>
      ) : null}
      {viewport !== "mobile" && hydrationState.kind === "queued" ? (
        <XtermPlaceholder state="queued" queuePosition={hydrationState.queuePosition} />
      ) : null}
      {showReplayOverlay ? (
        <div className={replayClassName} role="status" aria-live="polite">
          <div className="xterm-replay-overlay__card">
            {replayUiState.kind === "loading" ? (
              <div className="xterm-replay-overlay__spinner" aria-hidden="true" />
            ) : null}
            <div className="xterm-replay-overlay__title">{replayTitle}</div>
            {replayBody ? <div className="xterm-replay-overlay__body">{replayBody}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default XtermHost;
