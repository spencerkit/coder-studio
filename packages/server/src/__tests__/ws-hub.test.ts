/**
 * Tests for WebSocket Hub
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsHub } from '../ws/hub.js';
import { EventBus } from '../bus/event-bus.js';
import WebSocket from 'ws';
import type { FastifyRequest } from 'fastify';
import type { CommandContext } from '../ws/dispatch.js';

describe('WsHub', () => {
  let hub: WsHub;
  let eventBus: EventBus;
  let mockCommandContext: CommandContext;

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
    };
    hub = new WsHub({ eventBus, commandContext: mockCommandContext });
  });

  afterEach(() => {
    hub.destroy();
    eventBus.clear();
  });

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

  it('should accept first connection as writer', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );
  });

  it('should reject second connection when writer exists', () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    hub.handleConnection(socket1, createMockRequest());
    hub.handleConnection(socket2, createMockRequest());

    // First socket should be accepted
    expect(socket1.send).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );

    // Second socket should be rejected
    expect(socket2.send).toHaveBeenCalledWith(
      expect.stringContaining('rejected')
    );
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

    // Subscribe to all workspace events
    const messageHandler = socket.on.mock.calls.find(
      (call: any[]) => call[0] === 'message'
    )?.[1];

    if (messageHandler) {
      messageHandler(
        Buffer.from(JSON.stringify({ kind: 'subscribe', topics: ['*'] }))
      );
    }

    // Emit a domain event
    eventBus.emit({
      type: 'session.state.changed',
      sessionId: 'sess-123',
      from: 'starting',
      to: 'running',
    });

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('session.sess-123.state')
    );
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

  it('should return writer client', () => {
    const socket = createMockSocket();
    hub.handleConnection(socket, createMockRequest());

    const writer = hub.getWriter();
    expect(writer).toBeDefined();
    expect(writer?.id).toBeDefined();
  });

  it('should return null for writer when no connections', () => {
    expect(hub.getWriter()).toBeNull();
  });
});
