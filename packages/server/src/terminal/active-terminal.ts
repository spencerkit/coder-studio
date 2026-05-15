// Active terminal instance (spec §4.5)

import type { Terminal } from "@coder-studio/core";
import { RING_BUFFER_SIZE } from "./constants";
import { RingBuffer } from "./ring-buffer";
import type { HeadlessSnapshotBuffer } from "./terminal-snapshot-buffer";
import type { PtyProcess, RuntimeTerminalRecord, TerminalSpec } from "./types";

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
    return {
      id: this.id,
      workspaceId: this.spec.workspaceId,
      kind: this.spec.kind,
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

  static fromRuntimeRecord(record: RuntimeTerminalRecord): ActiveTerminal {
    const detachedPty: PtyProcess = {
      onData: () => undefined,
      onExit: () => undefined,
      write: () => undefined,
      resize: () => undefined,
      kill: async () => undefined,
    };

    const active = new ActiveTerminal(
      record.id,
      {
        workspaceId: record.workspaceId,
        kind: record.kind,
        argv: record.argv,
        cwd: record.cwd,
        cols: record.cols,
        rows: record.rows,
        title: record.title,
      },
      detachedPty,
      new RingBuffer(RING_BUFFER_SIZE),
      undefined,
      record.createdAt
    );

    active.alive = record.alive;
    active.exitCode = record.exitCode;
    active.currentCols = record.cols;
    active.currentRows = record.rows;
    return active;
  }
}
