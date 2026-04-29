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
import type { EventBus } from '../bus/event-bus'
import { ActiveTerminal } from './active-terminal'
import { RingBuffer } from './ring-buffer'

// 64 MiB per terminal — freed when the terminal exits
const RING_BUFFER_SIZE = 64 * 1024 * 1024

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
      throw new Error(`Terminal spawn failed: ${error.message}`)
    }

    const ringBuffer = new RingBuffer(RING_BUFFER_SIZE)

    // Create active terminal
    const active = new ActiveTerminal(id, spec, pty, ringBuffer)

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

      // Emit terminal.output DomainEvent
      const event: DomainEvent = {
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: id,
        chunk: buffer,
        seq,
      } satisfies DomainEvent
      this.deps.eventBus.emit(event)
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

      // Keep ActiveTerminal object for 1s to allow replay, then cleanup
      setTimeout(() => {
        this.terminals.delete(id)
      }, 1000)

      // Mark as ended in database
      this.deps.db.markEnded(id, Date.now(), exitCode)
    })
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

    terminal.pty.write(bytes)
  }

  /**
   * Resize terminal
   */
  resize(terminalId: TerminalId, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || !terminal.alive) {
      // Resize fails silently if terminal not alive
      return
    }

    terminal.pty.resize(cols, rows)
  }

  /**
   * Kill terminal process
   */
  kill(terminalId: TerminalId, signal: NodeJS.Signals = 'SIGTERM'): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      terminal.pty.kill(signal)
    }
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
      return terminal.ringBuffer.replayFrom(lastSeq)
    }

    return { status: 'unknown' }
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
    for (const terminal of this.terminals.values()) {
      if (terminal.alive) {
        terminal.pty.kill('SIGTERM')
      }
    }
    this.terminals.clear()
  }
}
