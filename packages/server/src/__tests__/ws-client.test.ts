/**
 * Tests for WebSocket Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsClient } from '../ws/client.js';
import WebSocket from 'ws';

describe('WsClient', () => {
  let mockSocket: any;
  let client: WsClient;

  beforeEach(() => {
    mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      bufferedAmount: 0,
    };

    client = new WsClient(mockSocket, 'test-client-id');
  });

  it('should create client with id', () => {
    expect(client.id).toBe('test-client-id');
  });

  it('should send message successfully', () => {
    const msg = {
      kind: 'event',
      topic: 'test.topic',
      seq: 1,
      timestamp: Date.now(),
      data: { test: 'data' },
    };

    const result = client.send(msg);

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it('should not send when socket not open', () => {
    mockSocket.readyState = WebSocket.CLOSED;

    const result = client.send({ kind: 'event', topic: 'test', seq: 1, timestamp: 0, data: {} });

    expect(result).toBe(false);
    expect(mockSocket.send).not.toHaveBeenCalled();
  });

  it('sendControl never drops on bufferedAmount (control class is unconditional)', () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024; // way above the old 1MiB threshold

    const result = client.sendControl({
      kind: 'event',
      topic: 'test',
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it('send() is an alias for sendControl()', () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024;

    const result = client.send({
      kind: 'event',
      topic: 'test',
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it('should subscribe to topics', () => {
    client.subscribe(['workspace.42.*', 'session.test.state']);

    expect(client.subscribesTo('workspace.42.meta')).toBe(true);
    expect(client.subscribesTo('workspace.42.session.test.state')).toBe(true);
    expect(client.subscribesTo('workspace.41.meta')).toBe(false);
  });

  it('should unsubscribe from topics', () => {
    client.subscribe(['workspace.42.*']);
    client.unsubscribe(['workspace.42.*']);

    expect(client.subscribesTo('workspace.42.meta')).toBe(false);
  });

  it('should match glob patterns', () => {
    client.subscribe(['workspace.*']);

    expect(client.subscribesTo('workspace.42')).toBe(true);
    expect(client.subscribesTo('workspace.42.session')).toBe(true);
    expect(client.subscribesTo('session.test')).toBe(false);
  });

  it('should send event', () => {
    const result = client.sendEvent('test.topic', { data: 'test' }, 1);

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('test.topic')
    );
  });

  it('should ping client', () => {
    client.ping();

    expect(mockSocket.ping).toHaveBeenCalled();
  });

  it('should close client', () => {
    client.close(1000, 'normal');

    expect(mockSocket.close).toHaveBeenCalledWith(1000, 'normal');
  });
});