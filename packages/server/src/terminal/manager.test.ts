// Unit tests for TerminalManager

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { TerminalManager } from './manager'
import { RingBuffer } from './ring-buffer'
import { EventBus } from '../bus/event-bus'
import type { PtyProcess, PtyHost, TerminalDatabase, TerminalSpec } from './types'
import type { Terminal } from '@coder-studio/core'
import * as snapshotBufferModule from './terminal-snapshot-buffer'

describe('TerminalManager', () => {
  let manager: TerminalManager
  let mockPtyHost: PtyHost
  let eventBus: EventBus
  let mockDb: TerminalDatabase
  let mockPty: PtyProcess

  beforeEach(() => {
    // Create mock PTY process
    mockPty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }

    // Create mock PTY host
    mockPtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    }

    // Create event bus
    eventBus = new EventBus()

    // Create mock database
    mockDb = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    }

    manager = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: mockDb,
    })
  })

  describe('create', () => {
    it('should create terminal with PTY process', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      expect(terminal.id).toBeDefined()
      expect(terminal.workspaceId).toBe(spec.workspaceId)
      expect(terminal.kind).toBe(spec.kind)
      expect(terminal.argv).toEqual(spec.argv)
      expect(terminal.cwd).toBe(spec.cwd)
      expect(terminal.alive).toBe(true)

      // Should spawn PTY
      expect(mockPtyHost.spawn).toHaveBeenCalledWith(
        spec.argv,
        expect.objectContaining({
          cwd: spec.cwd,
          cols: 120,
          rows: 30,
        })
      )

      // Should persist to database
      expect(mockDb.insert).toHaveBeenCalledWith(terminal)

      // Should wire up events
      expect(mockPty.onData).toHaveBeenCalled()
      expect(mockPty.onExit).toHaveBeenCalled()
    })

    it('should use custom cols and rows', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
        cols: 80,
        rows: 24,
      }

      manager.create(spec)

      expect(mockPtyHost.spawn).toHaveBeenCalledWith(
        spec.argv,
        expect.objectContaining({
          cols: 80,
          rows: 24,
        })
      )
    })

    it('should merge environment variables', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
        env: {
          MY_VAR: 'my_value',
        },
      }

      manager.create(spec)

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1]
      expect(spawnOptions.env.MY_VAR).toBe('my_value')
    })

    it('forces color env vars regardless of parent env', () => {
      vi.stubEnv('TERM', 'screen-256color')
      vi.stubEnv('COLORTERM', '')
      vi.stubEnv('FORCE_COLOR', '0')

      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      try {
        manager.create(spec)

        const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1]
        expect(spawnOptions.env.TERM).toBe('xterm-256color')
        expect(spawnOptions.env.COLORTERM).toBe('truecolor')
        expect(spawnOptions.env.FORCE_COLOR).toBe('3')
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('allows spec.env to override color env vars when explicitly provided', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
        env: {
          TERM: 'dumb',
          FORCE_COLOR: '0',
        },
      }

      manager.create(spec)

      const spawnOptions = (mockPtyHost.spawn as Mock).mock.calls[0][1]
      expect(spawnOptions.env.TERM).toBe('dumb')
      expect(spawnOptions.env.COLORTERM).toBe('truecolor')
      expect(spawnOptions.env.FORCE_COLOR).toBe('0')
    })

    it('should throw error on spawn failure', () => {
      const spawnError = new Error('Command not found')
      mockPtyHost.spawn = vi.fn().mockImplementation(() => {
        throw spawnError
      })

      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['invalid-command'],
        cwd: '/home/user',
      }

      expect(() => manager.create(spec)).toThrow('Terminal spawn failed')
    })

    it('creates a snapshot buffer for agent terminals only', () => {
      const shell = manager.create({
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      })
      const agent = manager.create({
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      })

      expect(manager.get(shell.id)?.snapshotBuffer).toBeUndefined()
      expect(manager.get(agent.id)?.snapshotBuffer).toBeDefined()
    })

    it('degrades gracefully when the snapshot buffer fails to initialize', async () => {
      const snapshotCtorSpy = vi
        .spyOn(snapshotBufferModule, 'HeadlessSnapshotBuffer')
        .mockImplementation(
          class MockHeadlessSnapshotBuffer {
            constructor() {
              throw new Error('headless init failed')
            }
          } as unknown as typeof snapshotBufferModule.HeadlessSnapshotBuffer
        )

      try {
        const terminal = manager.create({
          workspaceId: 'ws-123',
          kind: 'agent',
          argv: ['node', 'agent.js'],
          cwd: '/home/user',
        })

        expect(terminal.alive).toBe(true)
        expect(mockPtyHost.spawn).toHaveBeenCalledTimes(1)
        expect(manager.get(terminal.id)?.snapshotBuffer).toBeUndefined()
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: 'unsupported',
        })
      } finally {
        snapshotCtorSpy.mockRestore()
      }
    })
  })

  describe('PTY event handling', () => {
    it('should emit terminal.output event on PTY data', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Track emitted events
      const emittedEvents: any[] = []
      eventBus.on('terminal.output', (event) => emittedEvents.push(event))

      // Get the onData callback
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]

      // Simulate PTY output
      const output = 'Hello, world!'
      onDataCallback(output)

      // Should emit terminal.output event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from(output),
        seq: output.length,
      })
    })

    it('should handle PTY exit', async () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Track emitted events
      const emittedEvents: any[] = []
      eventBus.on('terminal.exited', (event) => emittedEvents.push(event))

      // Get the onExit callback
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0]

      // Simulate PTY exit
      onExitCallback({ exitCode: 0 })

      // Should mark terminal as dead
      const activeTerminal = manager.get(terminal.id)
      expect(activeTerminal?.alive).toBe(false)
      expect(activeTerminal?.exitCode).toBe(0)

      // Should emit terminal.exited event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.exited',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        exitCode: 0,
      })

      // Should mark as ended in database
      expect(mockDb.markEnded).toHaveBeenCalledWith(
        terminal.id,
        expect.any(Number),
        0
      )

      // Wait for cleanup timeout
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Should be removed from manager
      expect(manager.get(terminal.id)).toBeUndefined()
    })

    it('keeps replay live and marks snapshot unsupported when mirror writes fail', async () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)
      const activeTerminal = manager.get(terminal.id)
      const emittedEvents: any[] = []
      eventBus.on('terminal.output', (event) => emittedEvents.push(event))

      vi.spyOn(
        (activeTerminal!.snapshotBuffer! as unknown as { term: { write: () => void } }).term,
        'write'
      ).mockImplementation(() => {
        throw new Error('snapshot mirror exploded')
      })

      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]
      onDataCallback('live output')

      expect(emittedEvents).toHaveLength(1)
      expect(manager.replay(terminal.id, 0)).toMatchObject({
        status: 'ok',
        data: Buffer.from('live output'),
        seq: 11,
      })
      await expect(manager.snapshot(terminal.id)).resolves.toEqual({
        status: 'unsupported',
      })
    })

    it('keeps agent snapshots available until delayed exit cleanup runs', async () => {
      vi.useFakeTimers()

      try {
        const spec: TerminalSpec = {
          workspaceId: 'ws-123',
          kind: 'agent',
          argv: ['node', 'agent.js'],
          cwd: '/home/user',
        }

        const terminal = manager.create(spec)
        const activeTerminal = manager.get(terminal.id)
        const disposeSpy = vi.spyOn(activeTerminal!.snapshotBuffer!, 'dispose')
        const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]
        const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0]

        onDataCallback('snapshot me')
        await vi.runOnlyPendingTimersAsync()
        onExitCallback({ exitCode: 0 })

        await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
          status: 'ok',
          seq: 11,
        })
        expect(disposeSpy).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1000)

        expect(disposeSpy).toHaveBeenCalledTimes(1)
        await expect(manager.snapshot(terminal.id)).resolves.toEqual({
          status: 'unsupported',
        })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('write', () => {
    it('should write data to PTY', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)
      const data = Buffer.from('ls -la\n')

      manager.write(terminal.id, data)

      expect(mockPty.write).toHaveBeenCalledWith(data)
    })

    it('should throw error when terminal not found', () => {
      expect(() => manager.write('nonexistent', Buffer.from('test'))).toThrow(
        'Terminal not found'
      )
    })

    it('should throw error when terminal not alive', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Kill terminal
      const activeTerminal = manager.get(terminal.id)
      if (activeTerminal) {
        activeTerminal.alive = false
      }

      expect(() => manager.write(terminal.id, Buffer.from('test'))).toThrow(
        'Terminal is not alive'
      )
    })
  })

  describe('resize', () => {
    it('should resize terminal', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      manager.resize(terminal.id, 100, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(100, 40)
    })

    it('resizes the PTY before resizing the snapshot mirror', () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      })

      const snapshotResizeSpy = vi
        .spyOn(manager.get(terminal.id)!.snapshotBuffer!, 'resize')
        .mockImplementation(() => {})

      manager.resize(terminal.id, 100, 40)

      const ptyResizeOrder = (mockPty.resize as Mock).mock.invocationCallOrder[0]
      const snapshotResizeOrder = snapshotResizeSpy.mock.invocationCallOrder[0]

      expect(ptyResizeOrder).toBeLessThan(snapshotResizeOrder)
    })

    it('should fail silently when terminal not found', () => {
      // Should not throw
      manager.resize('nonexistent', 100, 40)
    })

    it('should fail silently when terminal not alive', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Kill terminal
      const activeTerminal = manager.get(terminal.id)
      if (activeTerminal) {
        activeTerminal.alive = false
      }

      // Should not throw
      manager.resize(terminal.id, 100, 40)
    })
  })

  describe('kill', () => {
    it('should kill terminal process', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      manager.kill(terminal.id)

      expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('should kill with custom signal', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      manager.kill(terminal.id, 'SIGKILL')

      expect(mockPty.kill).toHaveBeenCalledWith('SIGKILL')
    })

    it('should do nothing when terminal not found', () => {
      // Should not throw
      manager.kill('nonexistent')
    })

    it('does not dispose the snapshot buffer before the PTY exit cleanup window', () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      })

      const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, 'dispose')

      manager.kill(terminal.id)

      expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM')
      expect(disposeSpy).not.toHaveBeenCalled()
    })
  })

  describe('replay', () => {
    it('should replay terminal output', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onData callback and simulate output
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]
      onDataCallback('first output')
      onDataCallback('second output')

      // Replay from seq 0
      const result = manager.replay(terminal.id, 0)

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.data.toString()).toBe('first outputsecond output')
      }
    })

    it('should return unknown when terminal not found', () => {
      const result = manager.replay('nonexistent', 0)

      expect(result.status).toBe('unknown')
    })

    it('returns unknown after terminal exit cleanup', async () => {
      vi.useFakeTimers()

      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0]

      try {
        onDataCallback('session output')
        await vi.runOnlyPendingTimersAsync()
        onExitCallback({ exitCode: 0 })

        await vi.advanceTimersByTimeAsync(1000)

        const result = manager.replay(terminal.id, 0)
        expect(result.status).toBe('unknown')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('snapshot', () => {
    it('returns unsupported for shell terminals', async () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      })

      await expect(manager.snapshot(terminal.id)).resolves.toEqual({
        status: 'unsupported',
      })
    })

    it('returns unsupported for unknown terminals', async () => {
      await expect(manager.snapshot('nonexistent')).resolves.toEqual({
        status: 'unsupported',
      })
    })

    it('renders a text snapshot for agent terminals', async () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      })
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]

      onDataCallback('hello \x1b[31mworld\x1b[0m\n')

      await expect(
        manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe('hello world')
    })

    it('returns an empty rendered snapshot when snapshotting is unsupported', async () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      })

      await expect(
        manager.getRenderedSnapshot(terminal.id, { maxLines: 10, maxChars: 1000 })
      ).resolves.toBe('')
    })
  })

  describe('get', () => {
    it('should return active terminal by ID', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)
      const active = manager.get(terminal.id)

      expect(active).toBeDefined()
      expect(active?.id).toBe(terminal.id)
    })

    it('should return undefined for nonexistent terminal', () => {
      const result = manager.get('nonexistent')

      expect(result).toBeUndefined()
    })
  })

  describe('getAll', () => {
    it('should return all active terminals', () => {
      const spec1: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const spec2: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      manager.create(spec1)
      manager.create(spec2)

      const all = manager.getAll()

      expect(all).toHaveLength(2)
    })
  })

  describe('shutdown', () => {
    it('should kill all alive terminals', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      manager.create(spec)
      manager.create(spec)

      manager.shutdown()

      expect(mockPty.kill).toHaveBeenCalledTimes(2)
    })

    it('should clear terminals map', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      manager.create(spec)
      manager.shutdown()

      expect(manager.getAll()).toHaveLength(0)
    })

    it('disposes snapshot buffers during shutdown', () => {
      const terminal = manager.create({
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      })

      const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, 'dispose')

      manager.shutdown()

      expect(disposeSpy).toHaveBeenCalledTimes(1)
    })
  })
})
