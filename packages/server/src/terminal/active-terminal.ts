// Active terminal instance (spec §4.5)

import type { Terminal } from "@coder-studio/core";
import { RingBuffer } from "./ring-buffer";
import type { HeadlessSnapshotBuffer } from "./terminal-snapshot-buffer";
import type { PtyProcess, TerminalSpec } from "./types";

/**
 * Active terminal object that holds PTY instance and ring buffer
 */
export class ActiveTerminal {
  public alive = true;
  public exitCode?: number;
  public cleanupTimer: NodeJS.Timeout | null = null;
  // Track current PTY dimensions so TerminalManager.resize() can skip
  // redundant pty.resize() calls. Each unnecessary pty.resize() sends
  // SIGWINCH to the child process (e.g. codex), which triggers a full
  // clear-screen + repaint cycle. Under WebSocket back-pressure the
  // StreamBuffer may drop the clear-screen frame while delivering the
  // repaint frame, causing duplicate content on the frontend.
  public currentCols: number;
  public currentRows: number;

  constructor(
    public readonly id: string,
    public readonly spec: TerminalSpec,
    public readonly pty: PtyProcess,
    public readonly ringBuffer: RingBuffer,
    public readonly snapshotBuffer: HeadlessSnapshotBuffer | undefined,
    public readonly createdAt: number = Date.now()
  ) {
    this.currentCols = spec.cols ?? 120;
    this.currentRows = spec.rows ?? 30;
  }

  /**
   * Convert to DTO (Data Transfer Object) for external use
   */
  toDTO(): Terminal {
    const pid = this.pty.pid > 0 ? this.pty.pid : undefined;

    return {
      id: this.id,
      workspaceId: this.spec.workspaceId,
      kind: this.spec.kind,
      pid,
      title: this.spec.title ?? this.spec.argv.join(" "),
      cwd: this.spec.cwd,
      argv: this.spec.argv,
      cols: this.spec.cols ?? 120,
      rows: this.spec.rows ?? 30,
      alive: this.alive,
      createdAt: this.createdAt,
      endedAt: this.alive ? undefined : Date.now(),
      exitCode: this.exitCode,
    };
  }

  /**
   * Convert to database row for persistence
   */
  toRow(): Terminal {
    return this.toDTO();
  }
}
