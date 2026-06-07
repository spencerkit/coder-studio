/**
 * XtermHost Component
 *
 * Renders xterm.js terminal with:
 * - FitAddon for responsive sizing
 * - WebSocket event subscription for output
 * - User input dispatch to server
 * - Aurora Mint theme that follows the current UI mode
 */

import {
  type RecoveryClosedTerminalState,
  type TerminalInputActivity,
  Topics,
} from "@coder-studio/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  type ChangeEvent as ReactChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { resolveAppearancePersonalizationForViewport } from "../../../../appearance/personalization";
import { appearancePersonalizationAtom, themeAtom } from "../../../../atoms/app-ui";
import { dispatchCommandAtom, wsClientAtom } from "../../../../atoms/connection";
import { Button, LocalOverlay, Notice } from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { copyTextWithFallback } from "../../../../lib/clipboard";
import { useTranslation } from "../../../../lib/i18n";
import type { TerminalThemeDefinition } from "../../../../theme";
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
import { getTerminalFontSizeForViewport, terminalPreferencesAtom } from "../../preferences";
import { getGlobalRecoveryCoordinator } from "../../recovery-singleton";
import {
  classifyReplayFailure,
  isRecoveryControlPlaneError,
  type RecoveryUiMode,
  type RecoveryUiModeDetail,
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
const TERMINAL_RECOVERY_LOADING_OVERLAY_DELAY_MS = 1_200;

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

function binaryStringToBytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length);

  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff;
  }

  return bytes;
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

function resolveXtermTheme(themeId: string): TerminalThemeDefinition {
  const terminalTheme = getThemeById(themeId).terminalTheme;
  return {
    ...terminalTheme,
    // xterm theme parsing rejects the `transparent` keyword and falls back to
    // opaque black, so use an explicit transparent RGBA hex color.
    background: "#00000000",
  };
}

function resolveReportedXtermTheme(themeId: string): TerminalThemeDefinition {
  return getThemeById(themeId).terminalTheme;
}

function parseTerminalThemeRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }

  const hex = trimmed.slice(1);
  let normalized: string;

  if (hex.length === 3 || hex.length === 4) {
    normalized = hex
      .slice(0, 3)
      .split("")
      .map((channel) => `${channel}${channel}`)
      .join("");
  } else if (hex.length === 6 || hex.length === 8) {
    normalized = hex.slice(0, 6);
  } else {
    return null;
  }

  if (!/^[\da-f]{6}$/iu.test(normalized)) {
    return null;
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function formatTerminalThemeQueryResponse(ident: "10" | "11", color: string): string | null {
  const rgb = parseTerminalThemeRgb(color);
  if (!rgb) {
    return null;
  }

  const encodeChannel = (channel: number) => channel.toString(16).padStart(2, "0").repeat(2);
  return `\x1b]${ident};rgb:${encodeChannel(rgb[0])}/${encodeChannel(rgb[1])}/${encodeChannel(
    rgb[2]
  )}\x1b\\`;
}

function parseCssColorRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:\d*\.?\d+))?\s*\)$/iu
  );
  if (rgbMatch) {
    return [
      Math.min(255, Number.parseInt(rgbMatch[1] ?? "0", 10)),
      Math.min(255, Number.parseInt(rgbMatch[2] ?? "0", 10)),
      Math.min(255, Number.parseInt(rgbMatch[3] ?? "0", 10)),
    ];
  }

  return parseTerminalThemeRgb(trimmed);
}

function formatCssRgbColor(rgb: [number, number, number], alpha: number): string {
  const clampedAlpha = Math.min(Math.max(alpha, 0), 1);
  if (clampedAlpha >= 0.999) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(clampedAlpha * 1000) / 1000})`;
}

function shouldNormalizeTerminalCellBackground(element: HTMLSpanElement): boolean {
  return !Array.from(element.classList).some(
    (className) => className === "xterm-cursor" || className.startsWith("xterm-cursor-")
  );
}

function resolveTerminalCellBackgroundSource(element: HTMLSpanElement): string | null {
  const inlineBackground = element.style.backgroundColor.trim();
  if (inlineBackground) {
    return inlineBackground;
  }

  const hasPaletteBackgroundClass = Array.from(element.classList).some((className) =>
    className.startsWith("xterm-bg-")
  );
  if (!hasPaletteBackgroundClass || typeof window === "undefined") {
    return null;
  }

  const computedBackground = window.getComputedStyle(element).backgroundColor.trim();
  return computedBackground ? computedBackground : null;
}

function applyTerminalMaterialToRenderedRows(
  container: HTMLElement | null,
  alpha: number,
  range?: { start: number; end: number }
): void {
  if (!container) {
    return;
  }

  const rowsElement = container.querySelector(".xterm-rows");
  if (!(rowsElement instanceof HTMLElement)) {
    return;
  }

  const rowElements = Array.from(rowsElement.children);
  if (rowElements.length === 0) {
    return;
  }

  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(rowElements.length - 1, range?.end ?? rowElements.length - 1);

  for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
    const rowElement = rowElements[rowIndex];
    if (!(rowElement instanceof HTMLElement)) {
      continue;
    }

    const spanElements = rowElement.querySelectorAll("span");
    for (const spanElement of spanElements) {
      if (
        !(spanElement instanceof HTMLSpanElement) ||
        !shouldNormalizeTerminalCellBackground(spanElement)
      ) {
        continue;
      }

      const sourceBackground = resolveTerminalCellBackgroundSource(spanElement);
      if (!sourceBackground) {
        continue;
      }

      const rgb = parseCssColorRgb(sourceBackground);
      if (!rgb) {
        continue;
      }

      spanElement.style.backgroundColor = formatCssRgbColor(rgb, alpha);
    }
  }
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
  /** Closed session CTA label */
  closedSessionContinueLabel?: string;
  /** Closed session provider label for fallback copy */
  closedSessionProviderLabel?: string;
  /** Continue with same provider from a closed session */
  onClosedSessionContinue?: () => void;
  /** Close the current closed-session pane */
  onClosedSessionClose?: () => void;
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
  closedSessionContinueLabel,
  closedSessionProviderLabel,
  onClosedSessionClose,
  onClosedSessionContinue,
  terminalId,
  workspaceId,
  readOnly = false,
  isActiveSession = false,
  terminalKind: terminalKindProp,
}: XtermHostProps) {
  const t = useTranslation();
  const viewport = useViewport();
  const uiTheme = useAtomValue(themeAtom);
  const appearancePersonalization = useAtomValue(appearancePersonalizationAtom);
  const terminalPreferences = useAtomValue(terminalPreferencesAtom);
  const terminalFontSize = getTerminalFontSizeForViewport(terminalPreferences, viewport);
  const wsClient = useAtomValue(wsClientAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setTerminalMeta = useSetAtom(terminalMetaAtomFamily(terminalId));
  const [outputAtom, setOutputAtom] = useAtom(terminalOutputAtomFamily(terminalId));
  const meta = useAtomValue(terminalMetaAtomFamily(terminalId));
  const terminalMetaRef = useRef(meta);
  const terminalKind = terminalKindProp ?? meta?.kind ?? "shell";
  const baseIsInteractive = !readOnly && meta?.alive !== false;
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
  const recoveryReplayAnchorSeqRef = useRef<number | null>(null);
  const applyReplayPayloadRef = useRef<
    | ((payload: ReplayPayload, options?: { resetTerminalBeforeWrite?: boolean }) => Promise<void>)
    | null
  >(null);
  const applySnapshotPayloadRef = useRef<((payload: SnapshotPayload) => Promise<void>) | null>(
    null
  );
  const completeHistoricalRecoveryRef = useRef<
    ((coveredSeq: number, closed?: RecoveryClosedTerminalState) => Promise<void>) | null
  >(null);
  const failHistoricalRecoveryRef = useRef<((error: unknown) => Promise<void>) | null>(null);
  const showRecoveryCheckFailedRef = useRef<
    ((detail?: RecoveryUiModeDetail) => Promise<void>) | null
  >(null);
  const showUnrecoverableHistoryRef = useRef<(() => Promise<void>) | null>(null);
  const showUnavailableTerminalRef = useRef<(() => Promise<void>) | null>(null);
  const retryHistoricalRecoveryRef = useRef<(() => void) | null>(null);
  const manualRecoveryRetryAttemptedRef = useRef(false);
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
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(false);
  const isInteractive =
    baseIsInteractive && replayUiState.kind !== "closed" && replayUiState.kind !== "unavailable";
  const activeRecoveryUiModeRef = useRef<RecoveryUiMode>("blocking_rebuild");
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
  const resolvedTerminalTheme = resolveXtermTheme(uiTheme);
  const resolvedAppearancePersonalization = resolveAppearancePersonalizationForViewport(
    appearancePersonalization,
    viewport
  );
  const terminalMaterialBackgroundAlpha =
    uiTheme === "hc-dark" || uiTheme === "hc-light"
      ? 1
      : Math.min(Math.max(resolvedAppearancePersonalization.surfaceOpacity, 0), 100) / 100;
  const terminalMaterialBackgroundAlphaRef = useRef(terminalMaterialBackgroundAlpha);

  // Latest copies of callback identities used inside the mount effect, exposed
  // via refs so the effect's cleanup/re-creation is not tied to their churn.
  const handleInputRef = useRef<(data: string) => void | Promise<void>>(() => {});
  const handleBinaryInputRef = useRef<(data: string) => void | Promise<void>>(() => {});
  const handleResizeRef = useRef<(size: { cols: number; rows: number }) => void | Promise<void>>(
    () => {}
  );

  const recoveryCoordinator = getGlobalRecoveryCoordinator();

  useEffect(() => {
    terminalMetaRef.current = meta;
  }, [meta]);

  const markTerminalClosed = useCallback(
    (exitCode?: number) => {
      const currentMeta = terminalMetaRef.current;
      if (currentMeta?.alive === false) {
        return;
      }

      setTerminalMeta((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          alive: false,
          exitCode,
        };
      });

      if (terminalRef.current) {
        terminalRef.current.writeln(`\r\n[Process exited with code ${exitCode ?? 0}]`);
      }
    },
    [setTerminalMeta]
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
      terminalRef.current.options.theme = resolvedTerminalTheme;
    }
  }, [resolvedTerminalTheme]);

  useEffect(() => {
    terminalMaterialBackgroundAlphaRef.current = terminalMaterialBackgroundAlpha;
    applyTerminalMaterialToRenderedRows(containerRef.current, terminalMaterialBackgroundAlpha);
  }, [terminalMaterialBackgroundAlpha]);

  useEffect(() => {
    if (replayUiState.kind !== "loading") {
      setLoadingOverlayVisible(false);
      return;
    }

    setLoadingOverlayVisible(false);
    const timeoutId = setTimeout(() => {
      setLoadingOverlayVisible(true);
    }, TERMINAL_RECOVERY_LOADING_OVERLAY_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [replayUiState]);

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
    let longPressReady = false;

    const clearLongPressTimer = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      longPressTouchId = null;
      longPressStartClientX = 0;
      longPressStartClientY = 0;
      longPressLineText = null;
      longPressReady = false;
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
        const screenElement = container.querySelector(".xterm-screen");
        longPressReady = false;
        longPressLineText =
          terminal && rowsElement instanceof HTMLElement
            ? getLogicalLineTextFromTouchPoint({
                clientX: touch.clientX,
                clientY: touch.clientY,
                rowsElement,
                screenElement: screenElement instanceof HTMLElement ? screenElement : undefined,
                terminal,
              })
            : null;
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          longPressReady = true;
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
      const longPressTouch = findTouchByIdentifier(event.changedTouches, longPressTouchId);
      if (longPressTouch) {
        if (longPressReady) {
          const lineText = longPressLineText;
          clearLongPressTimer();
          state.activeTouchId = null;
          state.lastClientY = 0;
          state.carryPx = 0;
          state.pxPerLine = null;
          state.velocityPxPerMs = 0;
          state.gestureDidScroll = false;
          state.samples = [];
          copyMobileLongPressRef.current(lineText);
          return;
        }

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

  useEffect(() => {
    if (!terminalRef.current || terminalRef.current.options.fontSize === terminalFontSize) {
      return;
    }

    terminalRef.current.options.fontSize = terminalFontSize;
    scheduleFit();
  }, [scheduleFit, terminalFontSize]);

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
        await copyTextWithFallback(lineText);
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
      await copyTextWithFallback(selection);
    } catch {
      pushCopyOnSelectFailureToast();
    }
  }, [pushCopyOnSelectFailureToast, terminalPreferences.copyOnSelect, viewport]);

  const dispatchTerminalInput = useCallback(
    async (bytes: Uint8Array, activity: TerminalInputActivity, submittedText?: string) => {
      if (!interactiveRef.current) {
        return;
      }

      if (!wsClient) {
        console.error("Cannot send terminal input: WebSocket not connected");
        return;
      }

      await wsClient.sendTerminalInput(terminalId, bytes, activity, submittedText);
    },
    [terminalId, wsClient]
  );

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

        await dispatchTerminalInput(
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
    [dispatchTerminalInput, terminalId, updateCtrlMode]
  );

  const handleBinaryInput = useCallback(
    async (data: string) => {
      const bytes = binaryStringToBytes(data);

      traceTerminal(terminalId, "input.binary", {
        activity: "control",
        summary: summarizeTerminalData(bytes),
      });

      try {
        await dispatchTerminalInput(bytes, "control");
      } catch (error) {
        console.error("Failed to send terminal input:", error);
      }
    },
    [dispatchTerminalInput, terminalId]
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

  const {
    busy: uploadBusy,
    handleClipboardPaste,
    handleFiles,
  } = usePasteDropUpload({
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

  useEffect(() => {
    if (!recoveryCoordinator) {
      return;
    }

    return recoveryCoordinator.registerTerminal({
      terminalId,
      workspaceId,
      getRenderedSeq: () => recoveryReplayAnchorSeqRef.current ?? latestRenderedSeqRef.current,
      setUiMode: (mode, detail) => {
        activeRecoveryUiModeRef.current = mode;
        if (mode === "silent") {
          recoveryReplayAnchorSeqRef.current = null;
          setReplayUiState({ kind: "ready" });
          return;
        }

        if (mode === "closed") {
          recoveryReplayAnchorSeqRef.current = null;
          setReplayUiState({ kind: "closed" });
          return;
        }

        if (mode === "error") {
          if (detail?.reason === "too_old_no_snapshot") {
            if (showUnrecoverableHistoryRef.current) {
              void showUnrecoverableHistoryRef.current();
              return;
            }

            recoveryReplayAnchorSeqRef.current = null;
            setReplayUiState({ kind: "unrecoverable_history", reason: "too_old_no_snapshot" });
            return;
          }

          if (detail?.reason === "unknown_terminal") {
            if (showUnavailableTerminalRef.current) {
              void showUnavailableTerminalRef.current();
              return;
            }

            recoveryReplayAnchorSeqRef.current = null;
            setReplayUiState({ kind: "unavailable" });
            return;
          }

          if (detail?.reason === "reconcile_failed") {
            if (showRecoveryCheckFailedRef.current) {
              void showRecoveryCheckFailedRef.current(detail);
              return;
            }

            recoveryReplayAnchorSeqRef.current = null;
            setReplayUiState({ kind: "recovery_check_failed" });
            return;
          }

          if (failHistoricalRecoveryRef.current) {
            void failHistoricalRecoveryRef.current(new Error("terminal recovery failed"));
            return;
          }

          setReplayUiState({ kind: "retryable_failure", reason: "failed" });
          return;
        }

        if (
          (mode === "non_blocking_recovering" || mode === "blocking_rebuild") &&
          recoveryReplayAnchorSeqRef.current === null
        ) {
          recoveryReplayAnchorSeqRef.current = latestRenderedSeqRef.current;
        }

        setReplayUiState({ kind: "loading" });
      },
      markClosed: ({ exitCode }) => {
        markTerminalClosed(exitCode);
      },
      completeRecovery: async (headSeq, closed) => {
        await completeHistoricalRecoveryRef.current?.(headSeq, closed);
      },
      applyReplay: async (payload) => {
        await applyReplayPayloadRef.current?.(payload);
      },
      applySnapshot: async (payload) => {
        await applySnapshotPayloadRef.current?.(payload);
      },
    });
  }, [markTerminalClosed, recoveryCoordinator, terminalId, workspaceId]);

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
    handleBinaryInputRef.current = handleBinaryInput;
  }, [handleBinaryInput]);

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
      theme: resolveXtermTheme(initialThemeRef.current),
      allowTransparency: true,
      fontFamily: "JetBrains Mono, Fira Code, SF Mono, monospace",
      fontSize: terminalFontSize,
      scrollback: 5000,
      cursorBlink: isInteractive && !uploadBusy,
      cursorStyle: "block",
      disableStdin: !isInteractive || uploadBusy,
      allowProposedApi: true,
    });

    const reportTerminalThemeColor = (ident: "10" | "11", color: string) => {
      const response = formatTerminalThemeQueryResponse(ident, color);
      if (!response) {
        return false;
      }

      void handleInputRef.current(response, "system");
      return true;
    };

    const foregroundColorQueryDisposable = terminal.parser.registerOscHandler(10, (data) => {
      if (data !== "?") {
        return false;
      }

      return reportTerminalThemeColor(
        "10",
        resolveReportedXtermTheme(initialThemeRef.current).foreground
      );
    });

    const backgroundColorQueryDisposable = terminal.parser.registerOscHandler(11, (data) => {
      if (data !== "?") {
        return false;
      }

      return reportTerminalThemeColor(
        "11",
        resolveReportedXtermTheme(initialThemeRef.current).background
      );
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.onResize((size) => {
      void handleResizeRef.current(size);
    });
    terminal.onData((data) => {
      void handleInputRef.current(data);
    });
    if (typeof terminal.onBinary === "function") {
      terminal.onBinary((data) => {
        void handleBinaryInputRef.current(data);
      });
    }
    const renderDisposable =
      typeof terminal.onRender === "function"
        ? terminal.onRender(({ start, end }) => {
            applyTerminalMaterialToRenderedRows(
              containerRef.current,
              terminalMaterialBackgroundAlphaRef.current,
              { start, end }
            );
          })
        : undefined;
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
    type HistoricalWrite = {
      kind: "historical" | "pending";
      bytes: Uint8Array;
      seq: number;
      resetTerminalBeforeWrite?: boolean;
    };

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

    const releaseHydration = () => {
      if (viewport !== "mobile") {
        hydrationHandleRef.current?.release();
        hydrationReleasedRef.current = true;
      }
    };

    const finalizeHistoricalRecovery = (completedRecoveryMode: "initial" | "reconnect" | null) => {
      coldStartStateRef.current = "done";
      activeHistoricalRecoveryModeRef.current = null;
      if (completedRecoveryMode && pendingRecoveryModeRef.current === completedRecoveryMode) {
        pendingRecoveryModeRef.current = "reconnect";
      }
      reconnectRecoveryTriggerRef.current?.();
    };

    const writeHistoricalBatch = async (writes: HistoricalWrite[]) => {
      if (writes.length === 0) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let pendingWriteCount = writes.length;
        let settled = false;
        const markWriteRendered = (seq: number) => {
          if (mountedRef.current && replayWriteGenerationRef.current === replayWriteGeneration) {
            latestRenderedSeqRef.current = Math.max(latestRenderedSeqRef.current, seq);
          }

          pendingWriteCount = Math.max(0, pendingWriteCount - 1);
          if (pendingWriteCount === 0 && !settled) {
            settled = true;
            resolve();
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

          try {
            if (write.kind === "historical") {
              writeReplayBytes(write.bytes, () => {
                markWriteRendered(write.seq);
              });
              continue;
            }

            terminal.write(write.bytes, () => {
              markWriteRendered(write.seq);
            });
          } catch (error) {
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }
        }
      });
    };

    const flushHistoricalRecovery = async (options?: {
      bytes?: Uint8Array;
      coveredSeq?: number;
      resetTerminalBeforeWrite?: boolean;
    }) => {
      let coveredSeq = options?.coveredSeq ?? replayedSeqRef.current;
      const nextWrites: HistoricalWrite[] = [];

      if (options?.bytes && typeof options.coveredSeq === "number") {
        nextWrites.push({
          kind: "historical",
          bytes: options.bytes,
          seq: options.coveredSeq,
          resetTerminalBeforeWrite: options.resetTerminalBeforeWrite,
        });
      }

      replayCompletedRef.current = false;

      if (nextWrites.length > 0) {
        await writeHistoricalBatch(nextWrites);
      }

      replayedSeqRef.current = coveredSeq;
      latestRenderedSeqRef.current = Math.max(latestRenderedSeqRef.current, coveredSeq);
      replayCompletedRef.current = true;
      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
        lastSeq: Math.max(prev.lastSeq, coveredSeq),
      }));

      while (true) {
        const { entries, latestCoveredSeq } = collectPendingReplayChunks(coveredSeq);
        if (entries.length === 0) {
          break;
        }

        coveredSeq = latestCoveredSeq;
        const pendingWrites = entries.map((entry) => ({
          kind: "pending" as const,
          bytes: entry.bytes,
          seq: entry.seq,
        }));

        await writeHistoricalBatch(pendingWrites);
      }

      finalizeHistoricalRecovery(activeHistoricalRecoveryModeRef.current);
    };

    const completeHistoricalRecovery = async (
      coveredSeq: number,
      closed?: RecoveryClosedTerminalState
    ) => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      releaseHydration();
      await flushHistoricalRecovery({ coveredSeq });
      recoveryReplayAnchorSeqRef.current = null;
      if (closed) {
        markTerminalClosed(closed.exitCode);
      }
    };
    completeHistoricalRecoveryRef.current = completeHistoricalRecovery;

    const failHistoricalRecovery = async (error: unknown) => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      // If the WebSocket is not currently connected, this failure is almost
      // certainly a symptom of the transport outage rather than a real recovery
      // problem. The global connection banner already surfaces the outage, and
      // the coordinator's pendingSocketReconcile (or the legacy reconnect
      // trigger when no coordinator is installed) will reschedule recovery
      // once the socket comes back. Keep the UI in a quiet loading state so we
      // don't stack a "recovery failed" notice on top of the connection banner.
      const status = getConnectionStatus();
      if (status !== "connected") {
        traceTerminal(terminalId, "recovery.fail.deferred-ws-unhealthy", {
          status,
          error: error instanceof Error ? error.message : String(error),
        });
        activeRecoveryUiModeRef.current = "non_blocking_recovering";
        setReplayUiState({ kind: "loading" });
        deferRecoveryUntilReconnect();
        releaseHydration();
        return;
      }

      console.error("Failed to recover terminal output:", error);
      activeRecoveryUiModeRef.current = "error";
      const reason = classifyReplayFailure(error);
      setReplayUiState(
        manualRecoveryRetryAttemptedRef.current
          ? { kind: "failed", reason }
          : { kind: "retryable_failure", reason }
      );
      releaseHydration();
      await flushHistoricalRecovery();
    };
    failHistoricalRecoveryRef.current = failHistoricalRecovery;

    const showUnrecoverableHistory = async () => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      activeRecoveryUiModeRef.current = "error";
      recoveryReplayAnchorSeqRef.current = null;
      setReplayUiState({ kind: "unrecoverable_history", reason: "too_old_no_snapshot" });
      releaseHydration();
      await flushHistoricalRecovery();
    };
    showUnrecoverableHistoryRef.current = showUnrecoverableHistory;

    const showRecoveryCheckFailed = async (_detail?: RecoveryUiModeDetail) => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      activeRecoveryUiModeRef.current = "error";
      recoveryReplayAnchorSeqRef.current = null;
      setReplayUiState({ kind: "recovery_check_failed" });
      releaseHydration();
      await flushHistoricalRecovery();
    };
    showRecoveryCheckFailedRef.current = showRecoveryCheckFailed;

    const showUnavailableTerminal = async () => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      activeRecoveryUiModeRef.current = "error";
      recoveryReplayAnchorSeqRef.current = null;
      setReplayUiState({ kind: "unavailable" });
      releaseHydration();
      await flushHistoricalRecovery();
    };
    showUnavailableTerminalRef.current = showUnavailableTerminal;

    applyReplayPayloadRef.current = async (payload, options) => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      const resetTerminalBeforeWrite =
        options?.resetTerminalBeforeWrite ?? recoveryReplayAnchorSeqRef.current === 0;
      coldStartStateRef.current = "in-flight";
      activeHistoricalRecoveryModeRef.current = "reconnect";
      activeRecoveryUiModeRef.current = "silent";
      manualRecoveryRetryAttemptedRef.current = false;
      setReplayUiState({ kind: "ready" });
      releaseHydration();
      await flushHistoricalRecovery({
        bytes: payload.bytes,
        coveredSeq: payload.seq,
        resetTerminalBeforeWrite,
      });
      recoveryReplayAnchorSeqRef.current = null;
    };

    applySnapshotPayloadRef.current = async (payload) => {
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      coldStartStateRef.current = "in-flight";
      activeHistoricalRecoveryModeRef.current = "initial";
      activeRecoveryUiModeRef.current = "silent";
      manualRecoveryRetryAttemptedRef.current = false;
      setReplayUiState({ kind: "ready" });
      releaseHydration();
      await flushHistoricalRecovery({
        bytes: payload.bytes,
        coveredSeq: payload.seq,
        resetTerminalBeforeWrite: true,
      });
      recoveryReplayAnchorSeqRef.current = null;
    };

    const requestSnapshot = (options?: {
      resetTerminalBeforeWrite?: boolean;
      onUnavailable?: (result: SnapshotCommandResult) => void;
    }) => {
      if (!wsClient) {
        return;
      }

      if (recoveryReplayAnchorSeqRef.current === null) {
        recoveryReplayAnchorSeqRef.current = latestRenderedSeqRef.current;
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
          void applySnapshotPayloadRef.current?.({
            ...result.data,
            bytes: result.data.bytes,
          });
          return;
        }

        if (options?.onUnavailable) {
          options.onUnavailable(result);
          return;
        }

        if (!result.ok && isRecoveryControlPlaneError(result.error)) {
          void showRecoveryCheckFailedRef.current?.({
            reason: "reconcile_failed",
            operation: "terminal.snapshot",
          });
          return;
        }

        if (result.ok) {
          void showRecoveryCheckFailedRef.current?.({
            reason: "reconcile_failed",
            operation: "terminal.snapshot",
          });
          return;
        }

        void failHistoricalRecovery(result.error);
      });
    };

    const requestReplay = (
      lastSeq: number,
      options?: {
        onTooOld?: () => void;
        onError?: (error: unknown) => void;
        resetTerminalBeforeWrite?: boolean;
      }
    ) => {
      if (!wsClient) {
        return;
      }
      recoveryReplayAnchorSeqRef.current = lastSeq;
      coldStartStateRef.current = "in-flight";
      replayCompletedRef.current = false;
      if (lastSeq === 0) {
        setReplayUiState({ kind: "loading" });
      }
      traceTerminal(terminalId, "replay.request", { lastSeq });

      const replayPromise: Promise<ReplayCommandResult> = wsClient
        .sendCommand<ReplayPayload>(
          "terminal.replay",
          { terminalId, lastSeq },
          { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
        )
        .then((data) => ({ ok: true as const, data }))
        .catch((error) => ({ ok: false as const, error }));

      void replayPromise.then((result) => {
        if (result.ok && result.data?.status === "too_old" && options?.onTooOld) {
          options.onTooOld();
          return;
        }

        if (result.ok && result.data?.status === "ok" && result.data.bytes) {
          void applyReplayPayloadRef.current?.(
            {
              ...result.data,
              bytes: result.data.bytes,
            },
            { resetTerminalBeforeWrite: options?.resetTerminalBeforeWrite ?? lastSeq === 0 }
          );
          return;
        }

        if (result.ok && result.data?.status === "unknown") {
          void showUnavailableTerminal();
          return;
        }

        if (options?.onError) {
          options.onError(result.ok ? undefined : result.error);
          return;
        }

        if (!result.ok && isRecoveryControlPlaneError(result.error)) {
          void showRecoveryCheckFailedRef.current?.({
            reason: "reconcile_failed",
            operation: "terminal.replay",
          });
          return;
        }

        if (result.ok) {
          void showRecoveryCheckFailedRef.current?.({
            reason: "reconcile_failed",
            operation: "terminal.replay",
          });
          return;
        }

        void failHistoricalRecovery(result.error);
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
      typeof wsClient?.getStatus === "function" ? wsClient.getStatus() : "connected";

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

          if (reason === "too_old" && result.ok && result.data?.status === "unsupported") {
            void showUnrecoverableHistory();
            return;
          }

          if (
            reason === "error" &&
            (isRecoveryControlPlaneError(error) ||
              (!result.ok && isRecoveryControlPlaneError(result.error)))
          ) {
            void showRecoveryCheckFailedRef.current?.({
              reason: "reconcile_failed",
              operation: "terminal.snapshot",
            });
            return;
          }

          void failHistoricalRecovery(
            result.ok
              ? new Error(`terminal.snapshot returned status ${result.data?.status ?? "unknown"}`)
              : result.error
          );
        },
      });
    };

    const requestReconnectRecovery = (fromSeq: number) => {
      activeHistoricalRecoveryModeRef.current = "reconnect";
      activeRecoveryUiModeRef.current = "non_blocking_recovering";
      setReplayUiState({ kind: "loading" });
      retryHistoricalRecoveryRef.current = () => {
        requestReconnectRecovery(fromSeq);
      };
      requestReplay(fromSeq, {
        onTooOld: () => {
          requestReconnectSnapshotFallback("too_old");
        },
        onError: (error) => {
          requestReconnectSnapshotFallback("error", error);
        },
      });
    };

    const requestHistoricalRecovery = (mode: "initial" | "reconnect") => {
      if (!wsClient) {
        return;
      }

      if (mode === "reconnect") {
        requestReconnectRecovery(latestRenderedSeqRef.current);
        return;
      }

      activeHistoricalRecoveryModeRef.current = "initial";
      activeRecoveryUiModeRef.current = "blocking_rebuild";
      retryHistoricalRecoveryRef.current = () => {
        requestHistoricalRecovery("initial");
      };
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
          if (result.ok && result.data?.status === "unsupported") {
            requestReplay(0, {
              resetTerminalBeforeWrite: true,
              onTooOld: () => {
                void showUnrecoverableHistory();
              },
            });
            return;
          }

          requestReplay(0);
        },
      });
    };

    reconnectRecoveryTriggerRef.current = () => {
      if (!pendingRecoveryModeRef.current) {
        return;
      }

      if (typeof wsClient?.getStatus === "function" && wsClient.getStatus() !== "connected") {
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
              if (recoveryCoordinator) {
                void recoveryCoordinator.notifyReason("seq_gap", terminalId).catch((error) => {
                  void failHistoricalRecovery(error);
                });
              } else {
                requestReconnectRecovery(replayedSeqRef.current);
              }
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
            markTerminalClosed(exitData.code);
          }
        }
      );
    }

    (async () => {
      await initialReplayReady;
      if (!mountedRef.current) {
        return;
      }

      if (recoveryCoordinator) {
        await recoveryCoordinator.notifyReason("initial_mount", terminalId);
        return;
      }

      requestHistoricalRecovery("initial");
    })().catch((error) => {
      void failHistoricalRecovery(error);
    });

    return () => {
      disposed = true;
      applyReplayPayloadRef.current = null;
      applySnapshotPayloadRef.current = null;
      completeHistoricalRecoveryRef.current = null;
      failHistoricalRecoveryRef.current = null;
      showRecoveryCheckFailedRef.current = null;
      showUnrecoverableHistoryRef.current = null;
      showUnavailableTerminalRef.current = null;
      retryHistoricalRecoveryRef.current = null;
      recoveryReplayAnchorSeqRef.current = null;
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
      if (typeof renderDisposable === "function") {
        renderDisposable();
      } else {
        renderDisposable?.dispose?.();
      }
      foregroundColorQueryDisposable.dispose();
      backgroundColorQueryDisposable.dispose();
    };
  }, [
    hydrationState.kind,
    markTerminalClosed,
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

  /**
   * Legacy recovery fallback for tests and isolated hosts without AppProviders.
   * Production mounts install a global coordinator and skip this path.
   */
  useEffect(() => {
    if (recoveryCoordinator || !wsClient || typeof wsClient.onStatus !== "function") {
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
  }, [recoveryCoordinator, wsClient]);

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
      isInteractive &&
      terminalRef.current
    ) {
      terminalRef.current.focus();
    }
  }, [hydrationState.kind, isInteractive, viewport]);

  const showMobileInputBar = viewport === "mobile" && isInteractive;
  const mobileInputDisabled = !isInteractive || uploadBusy || connectionStatus !== "connected";
  const mobileInputLabels = {
    paste: t("terminal.mobile_input.paste"),
    upload: t("terminal.mobile_input.upload"),
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleMobilePaste = useCallback(async () => {
    // Try modern Clipboard API first
    if (navigator.clipboard) {
      try {
        await handleClipboardPaste();
        return;
      } catch (error) {
        console.debug("Clipboard API failed, showing paste dialog:", error);
      }
    }

    // Fallback: show paste dialog
    setShowPasteDialog(true);
  }, [handleClipboardPaste]);

  const handlePasteDialogSubmit = useCallback(async () => {
    const textarea = pasteTextareaRef.current;
    if (!textarea) {
      return;
    }

    const text = textarea.value;
    if (text) {
      await sendTextToTerminal(text);
      textarea.value = "";
    }

    setShowPasteDialog(false);
  }, [sendTextToTerminal]);

  const handlePasteDialogCancel = useCallback(() => {
    const textarea = pasteTextareaRef.current;
    if (textarea) {
      textarea.value = "";
    }
    setShowPasteDialog(false);
  }, []);

  const handleMobileUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRetryRecovery = useCallback(() => {
    manualRecoveryRetryAttemptedRef.current = true;
    setReplayUiState({ kind: "loading" });

    if (recoveryCoordinator) {
      void recoveryCoordinator.notifyReason("foreground_resume", terminalId).catch((error) => {
        void failHistoricalRecoveryRef.current?.(error);
      });
      return;
    }

    retryHistoricalRecoveryRef.current?.();
  }, [recoveryCoordinator, terminalId]);

  const handleFileInputChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) {
        return;
      }

      await handleFiles(files);
    },
    [handleFiles]
  );

  const shouldBlockTerminal =
    replayUiState.kind === "loading" && activeRecoveryUiModeRef.current === "blocking_rebuild";
  const canShowRecoverySurface = viewport === "mobile" || hydrationState.kind === "granted";
  // When WS is not connected, the global connection banner already explains the
  // situation. Suppressing recovery overlays/notices here keeps us from stacking
  // two competing messages on top of the terminal.
  const wsHealthy = connectionStatus === "connected";
  const showReplayOverlay =
    canShowRecoverySurface &&
    ((wsHealthy &&
      replayUiState.kind === "loading" &&
      shouldBlockTerminal &&
      loadingOverlayVisible) ||
      replayUiState.kind === "closed" ||
      replayUiState.kind === "unavailable");
  const showInlineRecoveryNotice =
    wsHealthy &&
    (replayUiState.kind === "recovery_check_failed" ||
      replayUiState.kind === "retryable_failure" ||
      replayUiState.kind === "failed" ||
      replayUiState.kind === "unrecoverable_history");

  let replayTitle = "";
  let replayBody = "";
  let replayClassName = "xterm-replay-overlay";
  const showRecoveryActions =
    (replayUiState.kind === "closed" || replayUiState.kind === "unavailable") &&
    terminalKind === "agent" &&
    Boolean(onClosedSessionContinue) &&
    Boolean(onClosedSessionClose);
  let noticeTitle = "";
  let noticeBody = "";
  let noticeAction: ReactNode = null;
  let noticeTone: "warning" | "error" = "warning";

  if (replayUiState.kind === "loading") {
    replayTitle = t("terminal.replay.loading_title");
    replayBody = t("terminal.replay.loading_body");
  } else if (replayUiState.kind === "closed") {
    replayClassName += " xterm-replay-overlay--degraded";
    replayBody = closedSessionProviderLabel
      ? t("terminal.replay.closed_body_with_provider", {
          provider: closedSessionProviderLabel,
        })
      : t("terminal.replay.closed_body");
    replayTitle = t("terminal.replay.closed_title");
  } else if (replayUiState.kind === "unavailable") {
    replayClassName += " xterm-replay-overlay--degraded";
    replayBody = closedSessionProviderLabel
      ? t("terminal.replay.unknown_body_with_provider", {
          provider: closedSessionProviderLabel,
        })
      : t("terminal.replay.unknown_body");
    replayTitle = t("terminal.replay.unknown_title");
  } else if (replayUiState.kind === "recovery_check_failed") {
    noticeTitle = t("terminal.replay.reconcile_failed_title");
    noticeBody = t("terminal.replay.reconcile_failed_body");
    noticeAction = (
      <Button
        onClick={() => {
          handleRetryRecovery();
        }}
        size="sm"
        variant="ghost"
      >
        {t("terminal.replay.recheck_action")}
      </Button>
    );
  } else if (replayUiState.kind === "retryable_failure") {
    noticeTitle = t("terminal.replay.retryable_title");
    noticeBody = t("terminal.replay.retryable_body");
    noticeAction = (
      <Button
        onClick={() => {
          handleRetryRecovery();
        }}
        size="sm"
        variant="ghost"
      >
        {t("terminal.replay.retry_action")}
      </Button>
    );
  } else if (replayUiState.kind === "failed") {
    noticeTitle = t("terminal.replay.failed_title");
    noticeBody = t("terminal.replay.failed_body");
  } else if (replayUiState.kind === "unrecoverable_history") {
    noticeTitle = t("terminal.replay.unrecoverable_title");
    noticeBody = t("terminal.replay.unrecoverable_body");
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
          onPaste={handleMobilePaste}
          onUpload={handleMobileUpload}
        />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,text/plain,.txt,.md,.json,.csv"
        multiple
        hidden
        onChange={(event) => {
          void handleFileInputChange(event);
        }}
      />
      {showInlineRecoveryNotice ? (
        <Notice action={noticeAction} message={noticeBody} title={noticeTitle} tone={noticeTone} />
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
        <LocalOverlay
          className="terminal-upload-overlay"
          open
          interactive={false}
          mode="status"
          surfaceClassName="xterm-replay-overlay__card"
        >
          <div>{t("terminal.upload.uploading")}</div>
        </LocalOverlay>
      ) : null}
      {showPasteDialog ? (
        <LocalOverlay
          ariaLabelledBy="paste-dialog-title"
          interactive
          mode="dialog"
          open
          onDismiss={handlePasteDialogCancel}
          surfaceClassName="paste-dialog"
        >
          <h3 id="paste-dialog-title" className="paste-dialog__title">
            {t("terminal.paste_dialog_title")}
          </h3>
          <textarea
            ref={pasteTextareaRef}
            className="paste-dialog__textarea"
            placeholder={t("terminal.paste_dialog_placeholder")}
            autoFocus
          />
          <div className="paste-dialog__actions">
            <button
              type="button"
              className="paste-dialog__button paste-dialog__button--secondary"
              onClick={handlePasteDialogCancel}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="paste-dialog__button paste-dialog__button--primary"
              onClick={() => {
                void handlePasteDialogSubmit();
              }}
            >
              {t("terminal.paste_dialog_submit")}
            </button>
          </div>
        </LocalOverlay>
      ) : null}
      {viewport !== "mobile" && hydrationState.kind === "queued" ? (
        <XtermPlaceholder state="queued" queuePosition={hydrationState.queuePosition} />
      ) : null}
      {showReplayOverlay ? (
        <LocalOverlay
          className={replayClassName}
          interactive={showRecoveryActions}
          mode={showRecoveryActions ? "dialog" : "status"}
          open
          surfaceClassName="xterm-replay-overlay__card"
        >
          {replayUiState.kind === "loading" ? (
            <div className="xterm-replay-overlay__spinner" aria-hidden="true" />
          ) : null}
          <div className="xterm-replay-overlay__title">{replayTitle}</div>
          {replayBody ? <div className="xterm-replay-overlay__body">{replayBody}</div> : null}
          {showRecoveryActions ? (
            <div className="xterm-replay-overlay__actions">
              <Button
                className="xterm-replay-overlay__action-btn"
                onClick={() => {
                  onClosedSessionContinue?.();
                }}
                variant="primary"
              >
                {closedSessionContinueLabel ?? t("action.confirm")}
              </Button>
              <Button
                className="xterm-replay-overlay__action-btn"
                onClick={() => {
                  onClosedSessionClose?.();
                }}
                variant="secondary"
              >
                {t("action.close")}
              </Button>
            </div>
          ) : null}
        </LocalOverlay>
      ) : null}
    </div>
  );
}

export default XtermHost;
