// Terminal manager implementation (spec §4.5)

import type { DomainEvent, Terminal } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus";
import {
  createWslLinuxNativeProcessEnv,
  normalizeWslRuntimeProcessPath,
} from "../runtime/wsl-runtime-path.js";
import { ActiveTerminal } from "./active-terminal";
import { RING_BUFFER_SIZE } from "./constants";
import {
  containsOsc11BackgroundQuery,
  formatOsc11BackgroundResponse,
  shouldInjectOsc11BackgroundResponse,
} from "./osc-theme-response";
import { RingBuffer } from "./ring-buffer";
import { type RenderOptions, renderSnapshotToText } from "./snapshot-render";
import { HeadlessSnapshotBuffer } from "./terminal-snapshot-buffer";
import type {
  PtyHost,
  PtyProcess,
  ReplayResult,
  TerminalDatabase,
  TerminalId,
  TerminalRecoveryInspection,
  TerminalSpec,
} from "./types";
import { TerminalSpawnError } from "./types";

function isTerminalTraceEnabled(): boolean {
  return process.env.CODER_STUDIO_TERMINAL_TRACE === "1";
}

/**
 * Parse a #RRGGBB / #RRGGBBAA / #RGB hex color into 8-bit RGB.
 * Returns null for any unrecognized input so callers can skip injection.
 */
function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }

  const hex = trimmed.slice(1);
  let r: number;
  let g: number;
  let b: number;
  if (hex.length === 3) {
    r = Number.parseInt(hex[0]! + hex[0]!, 16);
    g = Number.parseInt(hex[1]! + hex[1]!, 16);
    b = Number.parseInt(hex[2]! + hex[2]!, 16);
  } else if (hex.length === 6 || hex.length === 8) {
    r = Number.parseInt(hex.slice(0, 2), 16);
    g = Number.parseInt(hex.slice(2, 4), 16);
    b = Number.parseInt(hex.slice(4, 6), 16);
  } else {
    return null;
  }

  if ([r, g, b].some((v) => Number.isNaN(v))) {
    return null;
  }
  return { r, g, b };
}

/**
 * Derive an xterm-style COLORFGBG value from a theme background hex color.
 *
 * Returns "0;15" (dark text on light background) when the perceived luma is
 * above the threshold, "15;0" (light text on dark background) otherwise.
 * Returns undefined when the input cannot be parsed so the caller leaves the
 * variable untouched and the child TUI falls back to its own default.
 *
 * Luma uses the Rec. 601 coefficients; the threshold is 0.5 which is the same
 * cutoff most TUIs (Ink, chalk, bat, delta) use internally.
 */
export function computeColorFgBg(background: string): string | undefined {
  const rgb = parseHexColor(background);
  if (!rgb) {
    return undefined;
  }

  const luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luma > 0.5 ? "0;15" : "15;0";
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function summarizeTerminalData(data: string | Buffer) {
  const text = typeof data === "string" ? data : data.toString("utf8");
  return {
    length: typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength,
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

function traceTerminal(
  terminalId: TerminalId,
  event: string,
  details: Record<string, unknown> = {}
) {
  if (!isTerminalTraceEnabled()) {
    return;
  }

  console.debug("[terminal-trace]", {
    at: Date.now(),
    terminalId,
    event,
    ...details,
  });
}

type SnapshotResult =
  | { status: "ok"; data: Buffer; seq: number; cols: number; rows: number }
  | { status: "unsupported" };

/**
 * Generate unique terminal ID
 */
function generateId(): string {
  return `term_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Terminal manager - manages PTY lifecycle and ring buffers
 */
export class TerminalManager {
  private terminals = new Map<TerminalId, ActiveTerminal>();
  private explicitCloseWaiters = new Map<
    TerminalId,
    {
      signal: NodeJS.Signals;
      killCompleted: Promise<void>;
      markKillCompleted: () => void;
      finalized: boolean;
      promise: Promise<void>;
      resolve: () => void;
    }
  >();

  constructor(
    private readonly deps: {
      ptyHost: PtyHost;
      eventBus: EventBus;
      db: TerminalDatabase;
    }
  ) {}

  /**
   * Create a new terminal with PTY process
   */
  create(spec: TerminalSpec): Terminal {
    const id = generateId();

    // The PTY output is always rendered by xterm.js on the frontend, so force
    // a full-color terminal environment regardless of the server's parent TTY
    // (e.g. tmux's screen-256color, kitty's xterm-kitty, or CI's dumb).
    // FORCE_COLOR makes agent CLIs that are spawned directly (e.g. Claude Code
    // via Ink/chalk, Codex) emit ANSI colors without relying on the user's
    // shell rc to set it. spec.env can still override explicitly.
    //
    // COLORFGBG advertises the frontend xterm theme's light/dark intent so
    // TUIs that auto-pick color schemes (Claude Code, Codex, bat, delta, …)
    // can match the page background. We derive it from spec.themeBackground.
    // On Windows the ConPTY layer intercepts OSC 11 background-color queries
    // and never forwards xterm.js's response back to the child. COLORFGBG is
    // the signal for TUIs that read it (Claude Code, Codex, …); Gemini CLI
    // relies on OSC 11 instead and is handled in wireEvents() below.
    const derivedColorFgBg = spec.themeBackground
      ? computeColorFgBg(spec.themeBackground)
      : undefined;
    const terminalEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)
      ),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "3",
      ...(derivedColorFgBg ? { COLORFGBG: derivedColorFgBg } : {}),
      ...spec.env,
    };
    delete terminalEnv.COLORFGBG;
    if (derivedColorFgBg) {
      terminalEnv.COLORFGBG = derivedColorFgBg;
    }
    if (spec.env?.COLORFGBG) {
      terminalEnv.COLORFGBG = spec.env.COLORFGBG;
    }

    if (process.platform === "linux" && (terminalEnv.PATH ?? "").includes("/mnt/")) {
      if (spec.kind === "agent" || spec.kind === "task") {
        Object.assign(terminalEnv, createWslLinuxNativeProcessEnv(terminalEnv));
      } else {
        normalizeWslRuntimeProcessPath(terminalEnv);
      }
    }

    let pty: PtyProcess;
    try {
      pty = this.deps.ptyHost.spawn(spec.argv, {
        cwd: spec.cwd,
        env: terminalEnv,
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 30,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new TerminalSpawnError("spawn_failed_sync", error, {
        command: spec.argv[0],
        cwd: spec.cwd,
        terminalKind: spec.kind,
      });
    }

    const ringBuffer = new RingBuffer(RING_BUFFER_SIZE);
    let snapshotBuffer: HeadlessSnapshotBuffer | undefined;

    if (spec.kind === "shell" || spec.kind === "agent" || spec.kind === "task") {
      try {
        snapshotBuffer = new HeadlessSnapshotBuffer({
          cols: spec.cols ?? 120,
          rows: spec.rows ?? 30,
        });
      } catch (err) {
        traceTerminal(id, "snapshot.init.error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Create active terminal
    const active = new ActiveTerminal(id, spec, pty, ringBuffer, snapshotBuffer);

    // Wire up PTY events
    this.wireEvents(active);

    // Store in memory and persist to database
    this.terminals.set(id, active);
    this.deps.db.insert(active.toRow());

    // Emit terminal.created DomainEvent
    const event: DomainEvent = {
      type: "terminal.created",
      workspaceId: spec.workspaceId,
      terminalId: id,
      kind: spec.kind,
      title: spec.title ?? "",
      cwd: spec.cwd,
    } satisfies DomainEvent;
    this.deps.eventBus.emit(event);

    return active.toDTO();
  }

  /**
   * Wire up PTY process events
   */
  private wireEvents(active: ActiveTerminal): void {
    const { pty, ringBuffer, spec, id } = active;

    // Handle PTY output
    pty.onData((data: string) => {
      this.maybeInjectOsc11BackgroundResponse(active, data);

      const buffer = Buffer.from(data, "utf-8");
      const { seq } = ringBuffer.append(buffer);
      traceTerminal(id, "pty.output", {
        workspaceId: spec.workspaceId,
        seq,
        summary: summarizeTerminalData(buffer),
      });

      // Emit terminal.output DomainEvent
      const event: DomainEvent = {
        type: "terminal.output",
        workspaceId: spec.workspaceId,
        terminalId: id,
        chunk: buffer,
        seq,
      } satisfies DomainEvent;
      this.deps.eventBus.emit(event);

      if (active.snapshotBuffer && !active.snapshotBuffer.disabled) {
        try {
          active.snapshotBuffer.write(buffer, seq);
        } catch (err) {
          traceTerminal(id, "snapshot.write.error", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    // Handle PTY exit
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      active.alive = false;
      active.exitCode = exitCode;

      // Emit terminal.exited DomainEvent
      const event: DomainEvent = {
        type: "terminal.exited",
        workspaceId: spec.workspaceId,
        terminalId: id,
        exitCode,
      } satisfies DomainEvent;
      this.deps.eventBus.emit(event);

      const explicitClose = this.explicitCloseWaiters.get(id);
      if (explicitClose) {
        void explicitClose.killCompleted.finally(() => {
          if (!explicitClose.finalized) {
            explicitClose.finalized = true;
            this.finalizeTerminal(active);
          }
          this.explicitCloseWaiters.delete(id);
          explicitClose.resolve();
        });
      } else {
        // Keep ActiveTerminal object for 1s to allow replay, then cleanup
        active.cleanupTimer = setTimeout(() => {
          this.finalizeTerminal(active);
        }, 1000);
      }

      // Mark as ended in database
      this.deps.db.markEnded(id, Date.now(), exitCode);
    });
  }

  /**
   * Answer OSC 11 background-color queries on Windows before ConPTY can reply
   * with a stale value. Gemini CLI and similar TUIs read the response on stdin.
   */
  private maybeInjectOsc11BackgroundResponse(active: ActiveTerminal, data: string): void {
    if (!shouldInjectOsc11BackgroundResponse() || !active.alive) {
      return;
    }

    const themeBackground = active.spec.themeBackground;
    if (!themeBackground || !containsOsc11BackgroundQuery(data)) {
      return;
    }

    const response = formatOsc11BackgroundResponse(themeBackground);
    if (!response) {
      return;
    }

    traceTerminal(active.id, "pty.osc11.inject", {
      workspaceId: active.spec.workspaceId,
      themeBackground,
    });
    active.pty.write(response);
  }

  private finalizeTerminal(active: ActiveTerminal): void {
    if (active.cleanupTimer) {
      clearTimeout(active.cleanupTimer);
      active.cleanupTimer = null;
    }
    active.snapshotBuffer?.dispose();
    this.terminals.delete(active.id);
  }

  /**
   * Update the theme background used for OSC 11 injection and future spawns
   * for all alive terminals in a workspace.
   */
  syncThemeBackgroundForWorkspace(workspaceId: string, themeBackground: string | undefined): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.spec.workspaceId !== workspaceId || !terminal.alive) {
        continue;
      }

      terminal.spec.themeBackground = themeBackground;
    }
  }

  /**
   * Write data to terminal
   */
  write(terminalId: TerminalId, bytes: Buffer): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    if (!terminal.alive) {
      throw new Error("Terminal is not alive");
    }

    traceTerminal(terminalId, "pty.write", {
      summary: summarizeTerminalData(bytes),
    });
    terminal.pty.write(bytes);
  }

  /**
   * Resize terminal.
   *
   * Skips the syscall when cols/rows haven't changed. Every pty.resize()
   * delivers SIGWINCH to the child, and TUI apps (codex, claude) respond
   * with a full clear-screen + repaint. That redraw data floods the
   * StreamBuffer; under back-pressure the oldest frames (the clear-screen)
   * are dropped while the repaint frames survive, causing the frontend to
   * render repaint content without a preceding clear — visible as
   * duplicate content blocks.
   */
  resize(terminalId: TerminalId, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || !terminal.alive) {
      return;
    }

    if (terminal.currentCols === cols && terminal.currentRows === rows) {
      traceTerminal(terminalId, "pty.resize.skip", { cols, rows });
      return;
    }

    traceTerminal(terminalId, "pty.resize", {
      prevCols: terminal.currentCols,
      prevRows: terminal.currentRows,
      cols,
      rows,
    });
    terminal.currentCols = cols;
    terminal.currentRows = rows;
    terminal.pty.resize(cols, rows);
    if (terminal.snapshotBuffer && !terminal.snapshotBuffer.disabled) {
      try {
        terminal.snapshotBuffer.resize(cols, rows);
      } catch (err) {
        traceTerminal(terminalId, "snapshot.resize.error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Kill terminal process
   */
  kill(terminalId: TerminalId, signal: NodeJS.Signals = "SIGTERM"): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      void terminal.pty.kill(signal);
    }
  }

  close(terminalId: TerminalId, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return Promise.resolve();
    }

    if (!terminal.alive) {
      const existing = this.explicitCloseWaiters.get(terminalId);
      if (existing) {
        if (!existing.finalized) {
          existing.finalized = true;
          this.finalizeTerminal(terminal);
        }
        return existing.promise;
      }

      this.finalizeTerminal(terminal);
      return Promise.resolve();
    }

    const existing = this.explicitCloseWaiters.get(terminalId);
    if (existing) {
      if (existing.signal !== signal) {
        terminal.pty.kill(signal);
      }
      return existing.promise;
    }

    let resolve = () => {};
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve;
    });
    let markKillCompleted = () => {};
    const killCompleted = new Promise<void>((innerResolve) => {
      markKillCompleted = innerResolve;
    });
    this.explicitCloseWaiters.set(terminalId, {
      signal,
      killCompleted,
      markKillCompleted,
      finalized: false,
      promise,
      resolve,
    });
    void terminal.pty.kill(signal).finally(() => {
      const waiter = this.explicitCloseWaiters.get(terminalId);
      if (!waiter) {
        return;
      }

      waiter.markKillCompleted();
    });
    return promise;
  }

  killForWorkspace(workspaceId: string, signal: NodeJS.Signals = "SIGTERM"): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.spec.workspaceId !== workspaceId || !terminal.alive) {
        continue;
      }

      void terminal.pty.kill(signal);
    }
  }

  async closeForWorkspace(workspaceId: string, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const closes: Promise<void>[] = [];

    for (const terminal of this.terminals.values()) {
      if (terminal.spec.workspaceId !== workspaceId) {
        continue;
      }

      closes.push(this.close(terminal.id, signal));
    }

    await Promise.all(closes);
  }

  /**
   * Get active terminal by ID
   */
  get(terminalId: TerminalId): ActiveTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * Replay terminal output from a given sequence number
   */
  replay(terminalId: TerminalId, lastSeq: number): ReplayResult {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      const result = terminal.ringBuffer.replayFrom(lastSeq);
      traceTerminal(terminalId, "replay", {
        lastSeq,
        status: result.status,
        seq: result.status === "ok" ? result.seq : undefined,
        size: result.status === "ok" ? result.data.byteLength : undefined,
        summary: result.status === "ok" ? summarizeTerminalData(result.data) : undefined,
      });
      return result;
    }

    return { status: "unknown" };
  }

  inspectRecovery(terminalId: TerminalId, renderedSeq: number): TerminalRecoveryInspection {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { status: "unknown" };
    }

    const headSeq = terminal.ringBuffer.getSeq();
    const replay = terminal.ringBuffer.replayFrom(renderedSeq);

    return {
      status: "ok",
      headSeq,
      replay:
        replay.status === "too_old"
          ? { kind: "too_old" }
          : { kind: "available", fromSeq: renderedSeq },
      snapshot:
        terminal.snapshotBuffer && !terminal.snapshotBuffer.disabled
          ? { kind: "available" }
          : { kind: "unavailable" },
      alive: terminal.alive,
      exitCode: terminal.exitCode,
    };
  }

  /**
   * Serialize the current terminal screen state for hard-refresh recovery.
   */
  async snapshot(terminalId: TerminalId): Promise<SnapshotResult> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || !terminal.snapshotBuffer) {
      return { status: "unsupported" };
    }

    if (terminal.snapshotBuffer.disabled) {
      return { status: "unsupported" };
    }

    try {
      const result = await terminal.snapshotBuffer.snapshot();
      return {
        status: "ok",
        data: result.data,
        seq: result.seq,
        cols: result.cols,
        rows: result.rows,
      };
    } catch (err) {
      traceTerminal(terminalId, "snapshot.unsupported", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "unsupported" };
    }
  }

  /**
   * Render the current terminal snapshot to plain text for supervisor use.
   */
  async getRenderedSnapshot(terminalId: TerminalId, options: RenderOptions): Promise<string> {
    const snapshot = await this.snapshot(terminalId);
    if (snapshot.status !== "ok") {
      return "";
    }

    return renderSnapshotToText(snapshot.data, options);
  }

  /**
   * Read the last N bytes of terminal output from the active ring buffer.
   */
  getRingBufferTail(terminalId: TerminalId, bytes: number): Buffer {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      return terminal.ringBuffer.tail(bytes);
    }

    return Buffer.alloc(0);
  }

  /**
   * Get all active terminals
   */
  getAll(): ActiveTerminal[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Clean up all terminals (for graceful shutdown)
   */
  shutdown(): void {
    for (const waiter of this.explicitCloseWaiters.values()) {
      waiter.resolve();
    }
    this.explicitCloseWaiters.clear();

    for (const terminal of this.terminals.values()) {
      if (terminal.alive) {
        void terminal.pty.kill("SIGTERM");
      }
      this.finalizeTerminal(terminal);
    }
    this.terminals.clear();
  }
}
