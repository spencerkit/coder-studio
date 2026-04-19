import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WsClient } from '../client';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('web WsClient', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it('resends subscribed topics when the socket opens', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const handler = vi.fn();

    client.subscribe(['workspace.*', 'connection.*'], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    socket.triggerOpen();
    await connectPromise;

    expect(socket.sent).toContain(
      JSON.stringify({
        kind: 'subscribe',
        topics: ['workspace.*', 'connection.*'],
      })
    );
  });

  it('dispatches wildcard subscriptions for nested workspace events', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const handler = vi.fn();

    client.subscribe(['workspace.*'], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    socket.triggerOpen();
    await connectPromise;

    socket.triggerMessage({
      kind: 'event',
      topic: 'workspace.ws_1.session.sess_1.state',
      seq: 3,
      timestamp: Date.now(),
      data: { state: 'starting' },
    });

    expect(handler).toHaveBeenCalledWith(
      'workspace.ws_1.session.sess_1.state',
      { state: 'starting' },
      3
    );
  });
});
