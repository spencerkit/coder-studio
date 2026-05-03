// Terminal types (spec §4.5)

import type { Terminal } from '@coder-studio/core'

/**
 * Specification for creating a new terminal
 */
export interface TerminalSpec {
  workspaceId: string
  kind: 'agent' | 'shell'
  argv: string[]
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
  title?: string
}

/**
 * Options for spawning a PTY process
 */
export interface PtySpawnOptions {
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

/**
 * Result of replay operation
 */
export type ReplayResult =
  | { status: 'ok'; data: Buffer; seq: number }
  | { status: 'too_old' }
  | { status: 'unknown' }

/**
 * Error thrown when terminal is not alive
 */
export class TerminalNotAliveError extends Error {
  constructor(message = 'Terminal is not alive') {
    super(message)
    this.name = 'TerminalNotAliveError'
  }
}

/**
 * Error thrown when terminal spawn fails synchronously
 */
export class TerminalSpawnError extends Error {
  readonly code = 'terminal_spawn_failed'

  constructor(
    public readonly kind: 'spawn_failed_sync',
    public readonly cause: Error,
    public readonly details?: {
      command?: string
      cwd?: string
      terminalKind?: 'agent' | 'shell'
    }
  ) {
    super(`Terminal spawn failed: ${cause.message}`)
    this.name = 'TerminalSpawnError'
  }
}

/**
 * PTY process interface (abstraction over node-pty)
 */
export interface PtyProcess {
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
  write(data: Buffer | string): void
  resize(cols: number, rows: number): void
  kill(signal?: NodeJS.Signals): void
}

/**
 * PTY host interface (abstraction for testing)
 */
export interface PtyHost {
  spawn(argv: string[], options: PtySpawnOptions): PtyProcess
}

/**
 * Broadcaster interface (for WebSocket broadcast)
 */
export interface Broadcaster {
  broadcast(topic: string, payload: unknown): void
}

/**
 * Database interface for terminal persistence
 */
export interface TerminalDatabase {
  insert(terminal: Terminal): void
  markEnded(id: string, endedAt: number, exitCode: number): void
}

/**
 * Terminal ID type
 */
export type TerminalId = string
