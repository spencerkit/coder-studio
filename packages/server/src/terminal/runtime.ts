import type { DomainEvent, Terminal } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus";
import { ActiveTerminal } from "./active-terminal";
import { RING_BUFFER_SIZE } from "./constants";
import { RingBuffer } from "./ring-buffer";
import { HeadlessSnapshotBuffer } from "./terminal-snapshot-buffer";
import type {
  PtyHost,
  PtyProcess,
  ReplayResult,
  RuntimeActiveTerminal,
  RuntimeTerminalRecord,
  TerminalDatabase,
  TerminalId,
  TerminalRecoveryMetadata,
  TerminalSpec,
} from "./types";
import { TerminalNotAliveError, TerminalSpawnError } from "./types";

type SnapshotResult =
  | { status: "ok"; data: Buffer; seq: number; cols: number; rows: number }
  | { status: "unsupported" };

const RECOVERY_OUTPUT_BYTES = 64 * 1024;

function isTerminalTraceEnabled(): boolean {
  return process.env.CODER_STUDIO_TERMINAL_TRACE === "1";
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

function createTerminalEnv(spec: TerminalSpec): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
    ),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "3",
    ...spec.env,
  };
}

function createRuntimeActiveTerminal(
  active: ActiveTerminal,
  ownerServerInstanceId: string
): RuntimeActiveTerminal {
  const runtimeActive = active as RuntimeActiveTerminal;

  runtimeActive.ownerServerInstanceId = ownerServerInstanceId;
  runtimeActive.leaseStatus = "attached";
  runtimeActive.leaseRequestId = undefined;
  runtimeActive.leaseExpiresAt = undefined;
  runtimeActive.preserveTimer = null;
  runtimeActive.lastOutputAt = active.createdAt;
  runtimeActive.toLease = () => ({
    status: runtimeActive.leaseStatus,
    ownerServerInstanceId: runtimeActive.ownerServerInstanceId,
    requestId: runtimeActive.leaseRequestId,
    expiresAt: runtimeActive.leaseExpiresAt,
  });
  runtimeActive.toRuntimeRecord = () => ({
    ...active.toDTO(),
    ownerServerInstanceId: runtimeActive.ownerServerInstanceId,
    leaseStatus: runtimeActive.leaseStatus,
    lastOutputAt: runtimeActive.lastOutputAt,
  });
  runtimeActive.getRecoveryMetadata = (): TerminalRecoveryMetadata => ({
    alive: runtimeActive.alive,
    lastOutputAt: runtimeActive.lastOutputAt,
    recentOutputBase64: runtimeActive.ringBuffer.tail(RECOVERY_OUTPUT_BYTES).toString("base64"),
  });

  return runtimeActive;
}

export class TerminalRuntime {
  private terminals = new Map<TerminalId, RuntimeActiveTerminal>();
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

  create(id: string, spec: TerminalSpec, ownerServerInstanceId: string): Terminal {
    let pty: PtyProcess;
    try {
      pty = this.deps.ptyHost.spawn(spec.argv, {
        cwd: spec.cwd,
        env: createTerminalEnv(spec),
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
    if (spec.kind === "shell" || spec.kind === "agent") {
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

    const active = createRuntimeActiveTerminal(
      new ActiveTerminal(id, spec, pty, ringBuffer, snapshotBuffer),
      ownerServerInstanceId
    );

    this.wireEvents(active);
    this.terminals.set(id, active);
    this.deps.db.insert(active.toRow());

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

  detachForRestart(ownerServerInstanceId: string, requestId: string, ttlMs: number): string[] {
    const detachedIds: string[] = [];
    const expiresAt = Date.now() + ttlMs;

    for (const terminal of this.terminals.values()) {
      if (!terminal.alive || terminal.ownerServerInstanceId !== ownerServerInstanceId) {
        continue;
      }

      terminal.leaseStatus = "preserved";
      terminal.leaseRequestId = requestId;
      terminal.leaseExpiresAt = expiresAt;
      this.armPreserveTimer(terminal, requestId, ttlMs);
      detachedIds.push(terminal.id);
    }

    return detachedIds;
  }

  claimPreserved(requestId: string, nextOwnerServerInstanceId: string): RuntimeTerminalRecord[] {
    const claimed: RuntimeTerminalRecord[] = [];

    for (const terminal of this.terminals.values()) {
      if (!terminal.alive) {
        continue;
      }
      if (terminal.leaseStatus !== "preserved" || terminal.leaseRequestId !== requestId) {
        continue;
      }

      this.clearPreserveTimer(terminal);
      terminal.ownerServerInstanceId = nextOwnerServerInstanceId;
      terminal.leaseStatus = "attached";
      terminal.leaseRequestId = undefined;
      terminal.leaseExpiresAt = undefined;
      claimed.push(terminal.toRuntimeRecord());
    }

    return claimed;
  }

  handleOwnerDisconnect(ownerServerInstanceId: string): void {
    for (const terminal of this.terminals.values()) {
      if (!terminal.alive || terminal.ownerServerInstanceId !== ownerServerInstanceId) {
        continue;
      }
      if (terminal.leaseStatus !== "attached") {
        continue;
      }

      void terminal.pty.kill("SIGTERM");
    }
  }

  hydrateAttached(ownerServerInstanceId: string): RuntimeTerminalRecord[] {
    return Array.from(this.terminals.values())
      .filter(
        (terminal) =>
          terminal.alive &&
          terminal.ownerServerInstanceId === ownerServerInstanceId &&
          terminal.leaseStatus === "attached"
      )
      .map((terminal) => terminal.toRuntimeRecord());
  }

  write(terminalId: TerminalId, bytes: Buffer): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    if (!terminal.alive) {
      throw new TerminalNotAliveError();
    }

    traceTerminal(terminalId, "pty.write", {
      summary: summarizeTerminalData(bytes),
    });
    terminal.pty.write(bytes);
  }

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
        void terminal.pty.kill(signal);
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

  replay(terminalId: TerminalId, lastSeq: number): ReplayResult {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { status: "unknown" };
    }

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

  async snapshot(terminalId: TerminalId): Promise<SnapshotResult> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || !terminal.snapshotBuffer || terminal.snapshotBuffer.disabled) {
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

  getRecoveryMetadata(terminalId: TerminalId): TerminalRecoveryMetadata | undefined {
    return this.terminals.get(terminalId)?.getRecoveryMetadata();
  }

  getOwnerServerInstanceId(terminalId: TerminalId): string | undefined {
    return this.terminals.get(terminalId)?.ownerServerInstanceId;
  }

  get(terminalId: TerminalId): RuntimeActiveTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  private wireEvents(active: RuntimeActiveTerminal): void {
    const { pty, ringBuffer, spec, id } = active;

    pty.onData((data: string) => {
      const buffer = Buffer.from(data, "utf-8");
      const { seq } = ringBuffer.append(buffer);
      active.lastOutputAt = Date.now();

      traceTerminal(id, "pty.output", {
        workspaceId: spec.workspaceId,
        seq,
        summary: summarizeTerminalData(buffer),
      });

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

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      active.alive = false;
      active.exitCode = exitCode;
      this.clearPreserveTimer(active);

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
        active.cleanupTimer = setTimeout(() => {
          this.finalizeTerminal(active);
        }, 1000);
      }

      this.deps.db.markEnded(id, Date.now(), exitCode);
    });
  }

  private armPreserveTimer(
    terminal: RuntimeActiveTerminal,
    requestId: string,
    ttlMs: number
  ): void {
    this.clearPreserveTimer(terminal);
    terminal.preserveTimer = setTimeout(() => {
      terminal.preserveTimer = null;
      if (!terminal.alive) {
        return;
      }
      if (terminal.leaseStatus !== "preserved" || terminal.leaseRequestId !== requestId) {
        return;
      }

      void terminal.pty.kill("SIGTERM");
    }, ttlMs);
  }

  private clearPreserveTimer(terminal: RuntimeActiveTerminal): void {
    if (!terminal.preserveTimer) {
      return;
    }

    clearTimeout(terminal.preserveTimer);
    terminal.preserveTimer = null;
  }

  private finalizeTerminal(active: RuntimeActiveTerminal): void {
    this.clearPreserveTimer(active);
    if (active.cleanupTimer) {
      clearTimeout(active.cleanupTimer);
      active.cleanupTimer = null;
    }
    active.snapshotBuffer?.dispose();
    this.terminals.delete(active.id);
  }
}
