// Unit tests for TerminalManager

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { TerminalManager } from './manager'
import { RingBuffer } from './ring-buffer'
import type { PtyProcess, PtyHost, Broadcaster, TerminalDatabase, TerminalSpec } from './types'
import type { Terminal } from '@coder-studio/core'

describe('TerminalManager', () => {
  let manager: TerminalManager
  let mockPtyHost: PtyHost
  let mockBroadcaster: Broadcaster
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

    // Create mock broadcaster
    mockBroadcaster = {
      broadcast: vi.fn(),
    }

    // Create mock database
    mockDb = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    }

    manager = new TerminalManager({
      ptyHost: mockPtyHost,
      broadcaster: mockBroadcaster,
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
  })

  describe('PTY event handling', () => {
    it('should broadcast output on PTY data', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onData callback
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]

      // Simulate PTY output
      const output = 'Hello, world!'
      onDataCallback(output)

      // Should broadcast output
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        `workspace.${spec.workspaceId}.terminal.${terminal.id}.output`,
        expect.objectContaining({
          chunk: Buffer.from(output).toString('base64'),
          size: output.length,
          seq: output.length,
        })
      )
    })

    it('should handle PTY exit', async () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onExit callback
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0]

      // Simulate PTY exit
      onExitCallback({ exitCode: 0 })

      // Should mark terminal as dead
      const activeTerminal = manager.get(terminal.id)
      expect(activeTerminal?.alive).toBe(false)
      expect(activeTerminal?.exitCode).toBe(0)

      // Should broadcast exit event
      expect(mockBroadcaster.broadcast).toHaveBeenCalledWith(
        `workspace.${spec.workspaceId}.terminal.${terminal.id}.exit`,
        { code: 0 }
      )

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

    it('keeps replay history available after terminal exit cleanup', async () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)
      const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0]
      const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0]

      onDataCallback('session output')
      onExitCallback({ exitCode: 0 })

      await new Promise((resolve) => setTimeout(resolve, 1100))

      const result = manager.replay(terminal.id, 0)

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.data.toString()).toBe('session output')
      }
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
  })
})
