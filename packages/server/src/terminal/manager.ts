// Terminal manager implementation (spec §4.5)

import type { Terminal } from '@coder-studio/core'
import type {
  Broadcaster,
  PtyHost,
  ReplayResult,
  TerminalDatabase,
  TerminalId,
  TerminalSpec,
} from './types'
import { ActiveTerminal } from './active-terminal'
import { RingBuffer } from './ring-buffer'

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
      broadcaster: Broadcaster
      db: TerminalDatabase
    }
  ) {}

  /**
   * Create a new terminal with PTY process
   */
  create(spec: TerminalSpec): Terminal {
    const id = generateId()

    // Spawn PTY process
    let pty: PtyProcess
    try {
      pty = this.deps.ptyHost.spawn(spec.argv, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        cols: spec.cols ?? 120,
        rows: spec.rows ?? 30,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      throw new Error(`Terminal spawn failed: ${error.message}`)
    }

    // Create ring buffer (2 MiB)
    const ringBuffer = new RingBuffer(2 * 1024 * 1024)

    // Create active terminal
    const active = new ActiveTerminal(id, spec, pty, ringBuffer)

    // Wire up PTY events
    this.wireEvents(active)

    // Store in memory and persist to database
    this.terminals.set(id, active)
    this.deps.db.insert(active.toRow())

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

      // Broadcast output directly (not through EventBus)
      this.deps.broadcaster.broadcast(
        `workspace.${spec.workspaceId}.terminal.${id}.output`,
        {
          chunk: buffer.toString('base64'),
          size: buffer.length,
          seq,
        }
      )
    })

    // Handle PTY exit
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      active.alive = false
      active.exitCode = exitCode

      // Broadcast exit event
      this.deps.broadcaster.broadcast(
        `workspace.${spec.workspaceId}.terminal.${id}.exit`,
        {
          code: exitCode,
        }
      )

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
    if (!terminal) {
      return { status: 'unknown' }
    }

    return terminal.ringBuffer.replayFrom(lastSeq)
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

  /**
   * Write to terminal by session ID (helper for supervisor)
   * Note: This is a simplified implementation that requires session→terminal mapping
   * to be managed by the caller. For now, we assume sessionId equals terminalId.
   */
  writeToSession(sessionId: string, text: string): void {
    // In the full implementation, we would resolve sessionId → terminalId
    // For now, assume they're the same or handle the mapping elsewhere
    const terminal = this.terminals.get(sessionId)
    if (terminal && terminal.alive) {
      terminal.pty.write(Buffer.from(text, 'utf-8'))
    }
  }

  /**
   * Get recent terminal output for a session (helper for supervisor)
   * Note: Returns empty string for now. Full implementation would return
   * the last N lines from the ring buffer.
   */
  getSessionOutput(sessionId: string): string {
    // In the full implementation, we would:
    // 1. Resolve sessionId → terminalId
    // 2. Read from the ring buffer
    // 3. Return the last N lines
    // For now, return empty string
    return ''
  }
}
