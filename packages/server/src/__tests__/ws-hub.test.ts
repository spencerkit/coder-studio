/**
 * Tests for WebSocket Hub
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Topics,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TERMINAL_BINARY_HEADER_SIZE,
  TerminalBinaryFrameType,
} from '@coder-studio/core';
import { WsHub } from '../ws/hub.js';
import { EventBus } from '../bus/event-bus.js';
import WebSocket from 'ws';
import type { FastifyRequest } from 'fastify';
import type { CommandContext } from '../ws/dispatch.js';
import '../commands/terminal.js';

describe('WsHub', () => {
  let hub: WsHub;
  let eventBus: EventBus;
  let mockCommandContext: CommandContext;

  const createMockSocket = () => ({
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    bufferedAmount: 0,
  });

  const createMockRequest = () =>
    ({
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    }) as unknown as FastifyRequest;

  const subscribeToAllTopics = (socket: ReturnType<typeof createMockSocket>) => {
    const messageHandler = socket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'message'
    )?.[1];

    if (messageHandler) {
      messageHandler(Buffer.from(JSON.stringify({ kind: 'subscribe', topics: ['*'] })));
    }
  };

  const parseSentEvents = (socket: ReturnType<typeof createMockSocket>) =>
    socket.send.mock.calls
      .filter(([payload]: [string | Buffer]) => typeof payload === 'string')
      .map(([payload]: [string]) => JSON.parse(payload));

  const getLastSentEvent = (socket: ReturnType<typeof createMockSocket>) => {
    const sentEvents = parseSentEvents(socket);
    return sentEvents[sentEvents.length - 1];
  };

  const getLastSentBinary = (socket: ReturnType<typeof createMockSocket>) => {
    const binaryCalls = socket.send.mock.calls.filter(
      ([payload]: [string | Buffer, unknown]) => Buffer.isBuffer(payload)
    );
    return binaryCalls[binaryCalls.length - 1]?.[0] as Buffer | undefined;
  };

  beforeEach(() => {
    eventBus = new EventBus();
    mockCommandContext = {
      workspaceMgr: {} as any,
      sessionMgr: {} as any,
      terminalMgr: {} as any,
      hooksMgr: {} as any,
      eventBus,
      broadcaster: {} as any,
      db: {} as any,
      providerRegistry: [],
    };
    hub = new WsHub({
      eventBus,
      commandContext: mockCommandContext,
      config: { auth: { enabled: false } } as any,
      fencingMgr: {} as any,
    });
  });

  afterEach(() => {
    hub.destroy();
    eventBus.clear();
  });

  it('should accept first connection as writer', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );
  });

  it('should accept multiple connections (writer tracking moved to FencingManager)', () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    hub.handleConnection(socket1, createMockRequest());
    hub.handleConnection(socket2, createMockRequest());

    // Both sockets should be accepted with connected status
    expect(socket1.send).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );
    expect(socket2.send).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );

    // Each client should have unique IDs
    const send1Calls = socket1.send.mock.calls;
    const send2Calls = socket2.send.mock.calls;
    const clientId1 = JSON.parse(send1Calls[0][0]).data.clientId;
    const clientId2 = JSON.parse(send2Calls[0][0]).data.clientId;
    expect(clientId1).not.toBe(clientId2);
  });

  it('should broadcast to subscribed clients', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    // Simulate subscribe message
    const messageHandler = socket.on.mock.calls.find(
      (call: any[]) => call[0] === 'message'
    )?.[1];

    if (messageHandler) {
      messageHandler(
        Buffer.from(JSON.stringify({ kind: 'subscribe', topics: ['workspace.*'] }))
      );
    }

    hub.broadcast('workspace.42.meta', { test: 'data' });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('workspace.42.meta')
    );
  });

  it('should not broadcast to unsubscribed clients', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    // No subscription
    hub.broadcast('workspace.42.meta', { test: 'data' });

    // Should only have received the connection message
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('should handle domain events', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);

    // Emit a domain event
    eventBus.emit({
      type: 'session.state.changed',
      workspaceId: 'workspace-42',
      sessionId: 'sess-123',
      from: 'starting',
      to: 'running',
    });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('session.sess-123.state')
    );
  });

  it('should translate terminal.created events to the terminal created topic and payload', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);

    eventBus.emit({
      type: 'terminal.created',
      workspaceId: 'workspace-42',
      terminalId: 'term-123',
      kind: 'shell',
      title: 'Shell',
      cwd: '/tmp/workspace',
    });

    expect(getLastSentEvent(socket)).toMatchObject({
      kind: 'event',
      topic: Topics.terminalCreated('workspace-42', 'term-123'),
      data: {
        id: 'term-123',
        kind: 'shell',
        title: 'Shell',
        cwd: '/tmp/workspace',
        workspaceId: 'workspace-42',
      },
    });
  });

  it('should translate terminal.output events to the terminal output topic and payload', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);

    const chunk = Buffer.from('hello terminal');
    eventBus.emit({
      type: 'terminal.output',
      workspaceId: 'workspace-42',
      terminalId: 'term-123',
      chunk,
      seq: 7,
    });

    expect(getLastSentEvent(socket)).toMatchObject({
      kind: 'event',
      topic: Topics.terminalOutput('workspace-42', 'term-123'),
      seq: 7,
      data: {
        transport: 'binary',
        streamId: expect.any(Number),
        size: chunk.length,
      },
    });

    const binary = getLastSentBinary(socket);
    expect(binary).toBeDefined();
    const view = new DataView(binary!.buffer, binary!.byteOffset, binary!.byteLength);
    expect(view.getUint8(0)).toBe(TERMINAL_BINARY_PROTOCOL_VERSION);
    expect(view.getUint8(1)).toBe(TerminalBinaryFrameType.Output);
    expect(view.getUint32(4)).toBe(7);
    expect(view.getUint32(12)).toBe(chunk.length);
    expect(binary!.subarray(TERMINAL_BINARY_HEADER_SIZE)).toEqual(chunk);
  });

  it('routes terminal.output broadcasts through the stream path', () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      hub.handleConnection(socket, createMockRequest());
      subscribeToAllTopics(socket);
      socket.bufferedAmount = 1024 * 1024;
      socket.send.mockClear();

      eventBus.emit({
        type: 'terminal.output',
        workspaceId: 'workspace-42',
        terminalId: 'term-123',
        chunk: Buffer.from('hi'),
        seq: 1,
      });

      expect(socket.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes non-terminal-output events through the control path regardless of buffer', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);
    socket.bufferedAmount = 8 * 1024 * 1024;
    socket.send.mockClear();

    eventBus.emit({
      type: 'session.state.changed',
      workspaceId: 'workspace-42',
      sessionId: 'sess-123',
      from: 'starting',
      to: 'running',
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0]?.[0]).toMatch(/session\.sess-123\.state/);
  });

  it('should translate terminal.exited events to the terminal exit topic and payload', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    subscribeToAllTopics(socket);

    eventBus.emit({
      type: 'terminal.exited',
      workspaceId: 'workspace-42',
      terminalId: 'term-123',
      exitCode: 137,
    });

    expect(getLastSentEvent(socket)).toMatchObject({
      kind: 'event',
      topic: Topics.terminalExit('workspace-42', 'term-123'),
      data: {
        code: 137,
      },
    });
  });

  it('should close all connections on destroy', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    hub.destroy();

    expect(socket.close).toHaveBeenCalled();
  });

  it('should ping all clients', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    hub.pingAll();

    expect(socket.ping).toHaveBeenCalled();
  });

  it('should return null for writer (deprecated - use FencingManager)', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    // getWriter() is deprecated and always returns null
    // Writer tracking is now handled by FencingManager
    const writer = hub.getWriter();
    expect(writer).toBeNull();
  });

  it('should return null for writer when no connections', () => {
    expect(hub.getWriter()).toBeNull();
  });

  it('defers terminal.input dispatch until the matching binary frame arrives', async () => {
    // Stand up a fresh hub with a writeable terminal manager so the dispatched
    // terminal.input can be observed. The handler reads the binary payload
    // from a module-level map populated by the hub once the binary frame is
    // delivered, so the test must verify both ordering and payload routing.
    hub.destroy();
    const write = vi.fn();
    const findSessionIdByTerminal = vi.fn().mockReturnValue(null);
    hub = new WsHub({
      eventBus,
      commandContext: {
        ...mockCommandContext,
        terminalMgr: { write } as any,
        sessionMgr: { findSessionIdByTerminal } as any,
      },
      config: { auth: { enabled: false } } as any,
      fencingMgr: {} as any,
    });

    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());
    const messageHandler = socket.on.mock.calls.find(
      (call: any[]) => call[0] === 'message'
    )?.[1];
    socket.send.mockClear();

    const streamId = 1_000_001;
    const jsonCommand = Buffer.from(
      JSON.stringify({
        kind: 'command',
        id: 'cmd-input-1',
        op: 'terminal.input',
        args: {
          terminalId: 'term-1',
          transport: 'binary',
          streamId,
          size: 5,
          activity: 'typing',
        },
      })
    );

    void messageHandler!(jsonCommand, false);

    // Yield microtasks so the hub gets a chance to await the binary frame.
    await Promise.resolve();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    const sentBeforeBinary = socket.send.mock.calls.filter(
      ([payload]: [unknown]) => typeof payload === 'string'
    );
    expect(sentBeforeBinary).toHaveLength(0);

    const payload = Buffer.from('hello');
    void messageHandler!(payload, true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(write).toHaveBeenCalledWith('term-1', payload);
    const result = socket.send.mock.calls
      .filter(([p]: [unknown]) => typeof p === 'string')
      .map(([p]: [string]) => JSON.parse(p))
      .find((m: any) => m.kind === 'result' && m.id === 'cmd-input-1');
    expect(result?.ok).toBe(true);
  });
});
