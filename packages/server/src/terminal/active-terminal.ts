// Active terminal instance (spec §4.5)

import type { Terminal } from '@coder-studio/core'
import type { PtyProcess, TerminalSpec } from './types'
import { RingBuffer } from './ring-buffer'

/**
 * Active terminal object that holds PTY instance and ring buffer
 */
export class ActiveTerminal {
  public alive = true
  public exitCode?: number

  constructor(
    public readonly id: string,
    public readonly spec: TerminalSpec,
    public readonly pty: PtyProcess,
    public readonly ringBuffer: RingBuffer,
    public readonly createdAt: number = Date.now()
  ) {}

  /**
   * Convert to DTO (Data Transfer Object) for external use
   */
  toDTO(): Terminal {
    return {
      id: this.id,
      workspaceId: this.spec.workspaceId,
      kind: this.spec.kind,
      title: this.spec.title ?? this.spec.argv.join(' '),
      cwd: this.spec.cwd,
      argv: this.spec.argv,
      cols: this.spec.cols ?? 120,
      rows: this.spec.rows ?? 30,
      alive: this.alive,
      createdAt: this.createdAt,
      endedAt: this.alive ? undefined : Date.now(),
      exitCode: this.exitCode,
    }
  }

  /**
   * Convert to database row for persistence
   */
  toRow(): Terminal {
    return this.toDTO()
  }
}
