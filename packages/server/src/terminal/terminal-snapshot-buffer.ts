import { SerializeAddon } from '@xterm/addon-serialize'
import XtermHeadless from '@xterm/headless'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { TERMINAL_SNAPSHOT_SCROLLBACK } from './constants'

const { Terminal } = XtermHeadless

export interface TerminalSnapshotResult {
  data: Buffer
  seq: number
  cols: number
  rows: number
}

export class SnapshotUnsupportedError extends Error {
  constructor(message = 'Terminal snapshot buffer is unavailable') {
    super(message)
    this.name = 'SnapshotUnsupportedError'
  }
}

export class HeadlessSnapshotBuffer {
  private term: HeadlessTerminal | null
  private addon: SerializeAddon | null
  private cols: number
  private rows: number
  private mirroredSeq = 0
  private disabledState = false
  private disposed = false
  private pendingWriteCount = 0
  private drainResolvers: Array<() => void> = []

  constructor(options: { cols: number; rows: number; scrollback?: number }) {
    this.cols = options.cols
    this.rows = options.rows
    this.term = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback ?? TERMINAL_SNAPSHOT_SCROLLBACK,
      allowProposedApi: true,
    })
    this.addon = new SerializeAddon()
    this.term.loadAddon(this.addon)
  }

  get disabled(): boolean {
    return this.disabledState
  }

  write(chunk: Buffer, seq: number): void {
    const term = this.requireTerminal()

    this.pendingWriteCount += 1
    try {
      term.write(chunk, () => {
        this.mirroredSeq = seq
        this.pendingWriteCount = Math.max(0, this.pendingWriteCount - 1)
        this.resolveDrainIfIdle()
      })
    } catch (error) {
      this.pendingWriteCount = Math.max(0, this.pendingWriteCount - 1)
      this.disable()
      throw error
    }
  }

  resize(cols: number, rows: number): void {
    const term = this.requireTerminal()

    try {
      term.resize(cols, rows)
      this.cols = cols
      this.rows = rows
    } catch (error) {
      this.disable()
      throw error
    }
  }

  async snapshot(): Promise<TerminalSnapshotResult> {
    this.requireTerminal()
    const addon = this.requireAddon()

    await this.waitForPendingWrites()

    try {
      const serialized = addon.serialize()
      return {
        data: Buffer.from(serialized, 'utf8'),
        seq: this.mirroredSeq,
        cols: this.cols,
        rows: this.rows,
      }
    } catch (error) {
      this.disable()
      throw error
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.term?.dispose()
    this.addon?.dispose()
    this.term = null
    this.addon = null
    this.disabledState = true
    this.pendingWriteCount = 0
    this.resolveDrainIfIdle()
  }

  private waitForPendingWrites(): Promise<void> {
    if (this.pendingWriteCount === 0) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.drainResolvers.push(resolve)
    })
  }

  private resolveDrainIfIdle(): void {
    if (this.pendingWriteCount !== 0) {
      return
    }

    const resolvers = this.drainResolvers
    this.drainResolvers = []
    for (const resolve of resolvers) {
      resolve()
    }
  }

  private requireTerminal(): HeadlessTerminal {
    if (this.disposed || this.disabledState || !this.term) {
      throw new SnapshotUnsupportedError()
    }

    return this.term
  }

  private requireAddon(): SerializeAddon {
    if (this.disposed || this.disabledState || !this.addon) {
      throw new SnapshotUnsupportedError()
    }

    return this.addon
  }

  private disable(): void {
    this.disabledState = true
    this.resolveDrainIfIdle()
  }
}
