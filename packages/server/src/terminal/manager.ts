// Terminal manager implementation (spec §4.5)

import type { Terminal, DomainEvent } from '@coder-studio/core'
import type {
  PtyHost,
  PtyProcess,
  ReplayResult,
  TerminalDatabase,
  TerminalId,
  TerminalSpec,
} from './types'
import { TerminalSpawnError } from './types'
import type { EventBus } from '../bus/event-bus'
import { ActiveTerminal } from './active-terminal'
import { RingBuffer } from './ring-buffer'
import { RING_BUFFER_SIZE } from './constants'
import { HeadlessSnapshotBuffer } from './terminal-snapshot-buffer'
import { renderSnapshotToText, type RenderOptions } from './snapshot-render'

function isTerminalTraceEnabled(): boolean {
  return process.env.CODER_STUDIO_TERMINAL_TRACE === '1'
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

function summarizeTerminalData(data: string | Buffer) {
  const text = typeof data === 'string' ? data : data.toString('utf8')
  return {
    length: typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength,
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
  }
}

function traceTerminal(terminalId: TerminalId, event: string, details: Record<string, unknown> = {}) {
  if (!isTerminalTraceEnabled()) {
    return
  }

  console.debug('[terminal-trace]', {
    at: Date.now(),
    terminalId,
    event,
    ...details,
  })
}

type SnapshotResult =
  | { status: 'ok'; data: Buffer; seq: number; cols: number; rows: number }
  | { status: 'unsupported' }

/**
 * Generate unique terminal ID
 */
function generateId(): string {
  return `term_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Terminal manager - manages PTY lifecycle and ring buffers
 */
export class TerminalManager {
  private terminals = new Map<TerminalId, ActiveTerminal>()
  private explicitCloseWaiters = new Map<
    TerminalId,
    {
      signal: NodeJS.Signals
      killCompleted: Promise<void>
      markKillCompleted: () => void
      finalized: boolean
      promise: Promise<void>
      resolve: () => void
    }
  >()

  constructor(
    private readonly deps: {
      ptyHost: PtyHost
      eventBus: EventBus
      db: TerminalDatabase
    }
  ) {}

  /**
   * Create a new terminal with PTY process
   */
  create(spec: TerminalSpec): Terminal {
    const id = generateId()

    // The PTY output is always rendered by xterm.js on the frontend, so force
    // a full-color terminal environment regardless of the server's parent TTY
    // (e.g. tmux's screen-256color, kitty's xterm-kitty, or CI's dumb).
    // FORCE_COLOR makes agent CLIs that are spawned directly (e.g. Claude Code
    // via Ink/chalk, Codex) emit ANSI colors without relying on the user's
    // shell rc to set it. spec.env can still override explicitly.
    const terminalEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)
      ),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      ...spec.env,
    }

    let pty: PtyProcess
    try {
      pty = this.deps.ptyHost.spawn(spec.argv, {
        cwd: spec.cwd,
        env: terminalEnv,
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 30,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      throw new TerminalSpawnError('spawn_failed_sync', error, {
        command: spec.argv[0],
        cwd: spec.cwd,
        terminalKind: spec.kind,
      })
    }

    const ringBuffer = new RingBuffer(RING_BUFFER_SIZE)
    let snapshotBuffer: HeadlessSnapshotBuffer | undefined

    if (spec.kind === 'agent') {
      try {
        snapshotBuffer = new HeadlessSnapshotBuffer({
          cols: spec.cols ?? 120,
          rows: spec.rows ?? 30,
        })
      } catch (err) {
        traceTerminal(id, 'snapshot.init.error', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Create active terminal
    const active = new ActiveTerminal(id, spec, pty, ringBuffer, snapshotBuffer)

    // Wire up PTY events
    this.wireEvents(active)

    // Store in memory and persist to database
    this.terminals.set(id, active)
    this.deps.db.insert(active.toRow())

    // Emit terminal.created DomainEvent
    const event: DomainEvent = {
      type: 'terminal.created',
      workspaceId: spec.workspaceId,
      terminalId: id,
      kind: spec.kind,
      title: spec.title ?? '',
      cwd: spec.cwd,
    } satisfies DomainEvent
    this.deps.eventBus.emit(event)

    return active.toDTO()
  }

  /**
   * Wire up PTY process events
   */
  private wireEvents(active: ActiveTerminal): void {
    const { pty, ringBuffer, spec, id } = active

    // Handle PTY output
    pty.onData((data: string) => {
      const buffer = Buffer.from(data, 'utf-8')
      const { seq } = ringBuffer.append(buffer)
      traceTerminal(id, 'pty.output', {
        workspaceId: spec.workspaceId,
        seq,
        summary: summarizeTerminalData(buffer),
      })

      // Emit terminal.output DomainEvent
      const event: DomainEvent = {
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: id,
        chunk: buffer,
        seq,
      } satisfies DomainEvent
      this.deps.eventBus.emit(event)

      if (active.snapshotBuffer && !active.snapshotBuffer.disabled) {
        try {
          active.snapshotBuffer.write(buffer, seq)
        } catch (err) {
          traceTerminal(id, 'snapshot.write.error', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })

    // Handle PTY exit
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      active.alive = false
      active.exitCode = exitCode

      // Emit terminal.exited DomainEvent
      const event: DomainEvent = {
        type: 'terminal.exited',
        workspaceId: spec.workspaceId,
        terminalId: id,
        exitCode,
      } satisfies DomainEvent
      this.deps.eventBus.emit(event)

      const explicitClose = this.explicitCloseWaiters.get(id)
      if (explicitClose) {
        void explicitClose.killCompleted.finally(() => {
          if (!explicitClose.finalized) {
            explicitClose.finalized = true
            this.finalizeTerminal(active)
          }
          this.explicitCloseWaiters.delete(id)
          explicitClose.resolve()
        })
      } else {
        // Keep ActiveTerminal object for 1s to allow replay, then cleanup
        active.cleanupTimer = setTimeout(() => {
          this.finalizeTerminal(active)
        }, 1000)
      }

      // Mark as ended in database
      this.deps.db.markEnded(id, Date.now(), exitCode)
    })
  }

  private finalizeTerminal(active: ActiveTerminal): void {
    if (active.cleanupTimer) {
      clearTimeout(active.cleanupTimer)
      active.cleanupTimer = null
    }
    active.snapshotBuffer?.dispose()
    this.terminals.delete(active.id)
  }

  /**
   * Write data to terminal
   */
  write(terminalId: TerminalId, bytes: Buffer): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`)
    }
    if (!terminal.alive) {
      throw new Error('Terminal is not alive')
    }

    traceTerminal(terminalId, 'pty.write', {
      summary: summarizeTerminalData(bytes),
    })
    terminal.pty.write(bytes)
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
    const terminal = this.terminals.get(terminalId)
    if (!terminal || !terminal.alive) {
      return
    }

    if (terminal.currentCols === cols && terminal.currentRows === rows) {
      traceTerminal(terminalId, 'pty.resize.skip', { cols, rows })
      return
    }

    traceTerminal(terminalId, 'pty.resize', {
      prevCols: terminal.currentCols,
      prevRows: terminal.currentRows,
      cols,
      rows,
    })
    terminal.currentCols = cols
    terminal.currentRows = rows
    terminal.pty.resize(cols, rows)
    if (terminal.snapshotBuffer && !terminal.snapshotBuffer.disabled) {
      try {
        terminal.snapshotBuffer.resize(cols, rows)
      } catch (err) {
        traceTerminal(terminalId, 'snapshot.resize.error', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  /**
   * Kill terminal process
   */
  kill(terminalId: TerminalId, signal: NodeJS.Signals = 'SIGTERM'): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      void terminal.pty.kill(signal)
    }
  }

  close(terminalId: TerminalId, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return Promise.resolve()
    }

    if (!terminal.alive) {
      const existing = this.explicitCloseWaiters.get(terminalId)
      if (existing) {
        if (!existing.finalized) {
          existing.finalized = true
          this.finalizeTerminal(terminal)
        }
        return existing.promise
      }

      this.finalizeTerminal(terminal)
      return Promise.resolve()
    }

    const existing = this.explicitCloseWaiters.get(terminalId)
    if (existing) {
      if (existing.signal !== signal) {
        terminal.pty.kill(signal)
      }
      return existing.promise
    }

    let resolve = () => {}
    const promise = new Promise<void>((innerResolve) => {
      resolve = innerResolve
    })
    let markKillCompleted = () => {}
    const killCompleted = new Promise<void>((innerResolve) => {
      markKillCompleted = innerResolve
    })
    this.explicitCloseWaiters.set(terminalId, {
      signal,
      killCompleted,
      markKillCompleted,
      finalized: false,
      promise,
      resolve,
    })
    void terminal.pty.kill(signal).finally(() => {
      const waiter = this.explicitCloseWaiters.get(terminalId)
      if (!waiter) {
        return
      }

      waiter.markKillCompleted()
    })
    return promise
  }

  killForWorkspace(workspaceId: string, signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.spec.workspaceId !== workspaceId || !terminal.alive) {
        continue
      }

      void terminal.pty.kill(signal)
    }
  }

  async closeForWorkspace(
    workspaceId: string,
    signal: NodeJS.Signals = 'SIGTERM'
  ): Promise<void> {
    const closes: Promise<void>[] = []

    for (const terminal of this.terminals.values()) {
      if (terminal.spec.workspaceId !== workspaceId) {
        continue
      }

      closes.push(this.close(terminal.id, signal))
    }

    await Promise.all(closes)
  }

  /**
   * Get active terminal by ID
   */
  get(terminalId: TerminalId): ActiveTerminal | undefined {
    return this.terminals.get(terminalId)
  }

  /**
   * Replay terminal output from a given sequence number
   */
  replay(terminalId: TerminalId, lastSeq: number): ReplayResult {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      const result = terminal.ringBuffer.replayFrom(lastSeq)
      traceTerminal(terminalId, 'replay', {
        lastSeq,
        status: result.status,
        seq: result.status === 'ok' ? result.seq : undefined,
        size: result.status === 'ok' ? result.data.byteLength : undefined,
        summary: result.status === 'ok' ? summarizeTerminalData(result.data) : undefined,
      })
      return result
    }

    return { status: 'unknown' }
  }

  /**
   * Serialize the current terminal screen state for hard-refresh recovery.
   */
  async snapshot(terminalId: TerminalId): Promise<SnapshotResult> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || terminal.spec.kind !== 'agent' || !terminal.snapshotBuffer) {
      return { status: 'unsupported' }
    }

    if (terminal.snapshotBuffer.disabled) {
      return { status: 'unsupported' }
    }

    try {
      const result = await terminal.snapshotBuffer.snapshot()
      return {
        status: 'ok',
        data: result.data,
        seq: result.seq,
        cols: result.cols,
        rows: result.rows,
      }
    } catch (err) {
      traceTerminal(terminalId, 'snapshot.unsupported', {
        error: err instanceof Error ? err.message : String(err),
      })
      return { status: 'unsupported' }
    }
  }

  /**
   * Render the current terminal snapshot to plain text for supervisor use.
   */
  async getRenderedSnapshot(terminalId: TerminalId, options: RenderOptions): Promise<string> {
    const snapshot = await this.snapshot(terminalId)
    if (snapshot.status !== 'ok') {
      return ''
    }

    return renderSnapshotToText(snapshot.data, options)
  }

  /**
   * Read the last N bytes of terminal output from the active ring buffer.
   */
  getRingBufferTail(terminalId: TerminalId, bytes: number): Buffer {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      return terminal.ringBuffer.tail(bytes)
    }

    return Buffer.alloc(0)
  }

  /**
   * Get all active terminals
   */
  getAll(): ActiveTerminal[] {
    return Array.from(this.terminals.values())
  }

  /**
   * Clean up all terminals (for graceful shutdown)
   */
  shutdown(): void {
    for (const waiter of this.explicitCloseWaiters.values()) {
      waiter.resolve()
    }
    this.explicitCloseWaiters.clear()

    for (const terminal of this.terminals.values()) {
      if (terminal.alive) {
        void terminal.pty.kill('SIGTERM')
      }
      this.finalizeTerminal(terminal)
    }
    this.terminals.clear()
  }
}
