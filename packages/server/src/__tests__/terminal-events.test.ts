/**
 * Terminal Event Tests
 *
 * Tests that TerminalManager emits correct DomainEvents via EventBus
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TerminalManager } from '../terminal/manager.js'
import { EventBus } from '../bus/event-bus.js'
import type { PtyHost, PtyProcess, TerminalDatabase, TerminalSpec } from '../terminal/types.js'
import type { DomainEvent } from '@coder-studio/core'

describe('Terminal Events', () => {
  let manager: TerminalManager
  let eventBus: EventBus
  let mockPtyHost: PtyHost
  let mockDb: TerminalDatabase
  let mockPty: PtyProcess
  let emittedEvents: DomainEvent[]

  beforeEach(() => {
    // Create mock PTY process
    mockPty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    }

    // Create mock PTY host
    mockPtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    }

    // Create mock database
    mockDb = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    }

    // Create event bus
    eventBus = new EventBus()

    // Track emitted events
    emittedEvents = []
    eventBus.on('terminal.created', (event) => emittedEvents.push(event))
    eventBus.on('terminal.output', (event) => emittedEvents.push(event))
    eventBus.on('terminal.exited', (event) => emittedEvents.push(event))

    manager = new TerminalManager({
      ptyHost: mockPtyHost,
      eventBus,
      db: mockDb,
    })
  })

  describe('terminal.created event', () => {
    it('should emit terminal.created event when terminal is created', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Should have emitted one terminal.created event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.created',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        kind: spec.kind,
        title: '',
        cwd: spec.cwd,
      })
    })

    it('should include title in terminal.created event when provided', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-123',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
        title: 'My Agent',
      }

      const terminal = manager.create(spec)

      expect(emittedEvents[0]).toEqual({
        type: 'terminal.created',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        kind: spec.kind,
        title: 'My Agent',
        cwd: spec.cwd,
      })
    })
  })

  describe('terminal.output event', () => {
    it('should emit terminal.output event on PTY data', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-456',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onData callback
      const onDataCallback = (mockPty.onData as any).mock.calls[0][0]

      // Clear previous events (terminal.created)
      emittedEvents.length = 0

      // Simulate PTY output
      const output = 'Hello, world!'
      onDataCallback(output)

      // Should have emitted one terminal.output event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from(output),
        seq: output.length,
      })
    })

    it('should emit multiple terminal.output events for multiple PTY outputs', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-789',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onData callback
      const onDataCallback = (mockPty.onData as any).mock.calls[0][0]

      // Clear previous events (terminal.created)
      emittedEvents.length = 0

      // Simulate multiple PTY outputs
      onDataCallback('first')
      onDataCallback('second')
      onDataCallback('third')

      // Should have emitted three terminal.output events
      expect(emittedEvents).toHaveLength(3)

      expect(emittedEvents[0]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from('first'),
        seq: 5,
      })

      expect(emittedEvents[1]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from('second'),
        seq: 11, // 5 + 6
      })

      expect(emittedEvents[2]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from('third'),
        seq: 16, // 11 + 5
      })
    })

    it('should preserve binary data in chunk', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-binary',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onData callback
      const onDataCallback = (mockPty.onData as any).mock.calls[0][0]

      // Clear previous events
      emittedEvents.length = 0

      // Simulate binary output (ANSI escape codes)
      const binaryOutput = '\x1b[32mColor\x1b[0m'
      onDataCallback(binaryOutput)

      // Should preserve the exact binary data
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.output',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        chunk: Buffer.from(binaryOutput),
        seq: binaryOutput.length,
      })

      // Verify buffer content
      const event = emittedEvents[0] as any
      expect(event.chunk.toString()).toBe(binaryOutput)
    })
  })

  describe('terminal.exited event', () => {
    it('should emit terminal.exited event on PTY exit', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-exit',
        kind: 'shell',
        argv: ['bash'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onExit callback
      const onExitCallback = (mockPty.onExit as any).mock.calls[0][0]

      // Clear previous events (terminal.created)
      emittedEvents.length = 0

      // Simulate PTY exit
      onExitCallback({ exitCode: 0 })

      // Should have emitted one terminal.exited event
      expect(emittedEvents).toHaveLength(1)
      expect(emittedEvents[0]).toEqual({
        type: 'terminal.exited',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        exitCode: 0,
      })
    })

    it('should emit terminal.exited event with non-zero exit code', () => {
      const spec: TerminalSpec = {
        workspaceId: 'ws-error',
        kind: 'agent',
        argv: ['node', 'agent.js'],
        cwd: '/home/user',
      }

      const terminal = manager.create(spec)

      // Get the onExit callback
      const onExitCallback = (mockPty.onExit as any).mock.calls[0][0]

      // Clear previous events
      emittedEvents.length = 0

      // Simulate PTY exit with error
      onExitCallback({ exitCode: 1 })

      expect(emittedEvents[0]).toEqual({
        type: 'terminal.exited',
        workspaceId: spec.workspaceId,
        terminalId: terminal.id,
        exitCode: 1,
      })
    })

  })
})
