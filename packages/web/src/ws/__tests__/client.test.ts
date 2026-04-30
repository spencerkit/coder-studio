import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TerminalBinaryFrameType,
} from '@coder-studio/core';
import { WsClient, resolveWsUrl } from '../client';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  url: string;
  binaryType: BinaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
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

  triggerBinaryMessage(payload: Uint8Array) {
    const slice = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    this.onmessage?.({ data: slice });
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
    vi.unstubAllEnvs();
    globalThis.WebSocket = originalWebSocket;
  });

  it('sets websocket binaryType to arraybuffer on connect', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    expect(socket.binaryType).toBe('arraybuffer');

    socket.triggerOpen();
    await connectPromise;
  });

  it('handles v2 output frame: routes directly to topic without waiting for JSON event', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const handler = vi.fn();

    client.subscribe(['workspace.w1.terminal.t1.output'], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const payloadBytes = new Uint8Array([65, 66, 67]);
    const frame = encodeTerminalOutputFrame(
      { topic: 'workspace.w1.terminal.t1.output', seq: 99, streamId: 5, payloadSize: 3 },
      payloadBytes,
    );
    socket.triggerBinaryMessage(frame);

    expect(handler).toHaveBeenCalledWith(
      'workspace.w1.terminal.t1.output',
      expect.objectContaining({
        transport: 'binary',
        streamId: 5,
        size: 3,
        bytes: expect.any(Uint8Array),
      }),
      99,
    );
    expect((handler.mock.calls[0] as [string, { bytes: Uint8Array }, number])[1].bytes).toEqual(
      payloadBytes,
    );
  });

  it('reassembles terminal replay binary frames before resolving the command', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand<{
      status: 'ok';
      transport: 'binary';
      streamId: number;
      size: number;
      seq: number;
      bytes: Uint8Array;
    }>('terminal.replay', { terminalId: 'term_1' });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === 'command' && entry.op === 'terminal.replay');

    expect(command).toBeTruthy();

    socket.triggerMessage({
      kind: 'result',
      id: command.id,
      ok: true,
      data: {
        status: 'ok',
        transport: 'binary',
        streamId: 21,
        size: 6,
        seq: 9,
      },
    });

    socket.triggerBinaryMessage(
      encodeTerminalBinaryFrame(
        {
          version: TERMINAL_BINARY_PROTOCOL_VERSION,
          type: TerminalBinaryFrameType.Replay,
          flags: 0,
          meta: 9,
          streamId: 21,
          payloadSize: 6,
        },
        new TextEncoder().encode('replay')
      )
    );

    await replayPromise.then((result) => {
      expect(result).toMatchObject({
        status: 'ok',
        transport: 'binary',
        streamId: 21,
        size: 6,
        seq: 9,
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode('replay')));
    });
  });

  it('allows terminal.replay to use a longer custom timeout without changing the default command timeout', async () => {
    vi.useFakeTimers();

    const client = new WsClient('ws://localhost:3000/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand('terminal.replay', { terminalId: 'term_1' }, { timeoutMs: 120_000 });
    const handledReplayPromise = replayPromise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(30_001);

    let settled = false;
    handledReplayPromise.finally(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(89_997);

    settled = false;
    handledReplayPromise.finally(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(replayPromise).rejects.toThrow('Command timeout: terminal.replay');
    await handledReplayPromise;

    vi.useRealTimers();
  });

  it('reassembles terminal replay when the binary frame arrives before the result', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand<{
      status: 'ok';
      transport: 'binary';
      streamId: number;
      size: number;
      seq: number;
      bytes: Uint8Array;
    }>('terminal.replay', { terminalId: 'term_1' });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === 'command' && entry.op === 'terminal.replay');

    expect(command).toBeTruthy();

    // Server sends binary frame first, JSON result afterwards (current
    // backend ordering — see commands/terminal.ts replay handler).
    socket.triggerBinaryMessage(
      encodeTerminalBinaryFrame(
        {
          version: TERMINAL_BINARY_PROTOCOL_VERSION,
          type: TerminalBinaryFrameType.Replay,
          flags: 0,
          meta: 9,
          streamId: 31,
          payloadSize: 6,
        },
        new TextEncoder().encode('replay')
      )
    );

    socket.triggerMessage({
      kind: 'result',
      id: command.id,
      ok: true,
      data: {
        status: 'ok',
        transport: 'binary',
        streamId: 31,
        size: 6,
        seq: 9,
      },
    });

    await replayPromise.then((result) => {
      expect(result).toMatchObject({
        status: 'ok',
        transport: 'binary',
        streamId: 31,
        size: 6,
        seq: 9,
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode('replay')));
    });
  });

  it('v2 output frame does not require a prior JSON event', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const handler = vi.fn();

    client.subscribe(['workspace.w1.terminal.t1.output'], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const frame = encodeTerminalOutputFrame(
      { topic: 'workspace.w1.terminal.t1.output', seq: 1, streamId: 1, payloadSize: 1 },
      new Uint8Array([42]),
    );
    socket.triggerBinaryMessage(frame);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generated UUID when crypto.randomUUID is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (array: Uint8Array) => {
          for (let i = 0; i < array.length; i++) {
            array[i] = i + 1;
          }
          return array;
        },
      },
    });

    try {
      const client = new WsClient('ws://127.0.0.1:4173/ws');
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      const commandPromise = client.sendCommand('workspace.list', {});

      const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === 'string');
      const command = sentStrings.map((entry) => JSON.parse(entry)).find((entry) => entry.op === 'workspace.list');

      expect(command.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      socket.triggerMessage({
        kind: 'result',
        id: command.id,
        ok: true,
        data: { ok: true },
      });

      await expect(commandPromise).resolves.toEqual({ ok: true });
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it('sends terminal input as metadata plus binary payload', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const inputPromise = client.sendTerminalInput('term_1', new TextEncoder().encode('你好'), 'typing');

    const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === 'string');
    const command = sentStrings.map((entry) => JSON.parse(entry)).find((entry) => entry.op === 'terminal.input');

    expect(command).toMatchObject({
      kind: 'command',
      op: 'terminal.input',
      args: {
        terminalId: 'term_1',
        transport: 'binary',
        streamId: expect.any(Number),
        size: new TextEncoder().encode('你好').byteLength,
        activity: 'typing',
      },
    });

    const sentBinary = socket.sent.find(
      (entry) => entry instanceof Uint8Array || ArrayBuffer.isView(entry) || entry instanceof ArrayBuffer
    );
    expect(sentBinary).toBeTruthy();

    socket.triggerMessage({
      kind: 'result',
      id: command.id,
      ok: true,
      data: undefined,
    });

    await expect(inputPromise).resolves.toBeUndefined();
  });

  it('includes submittedText metadata for submit activity terminal input', async () => {
    const client = new WsClient('ws://127.0.0.1:4173/ws');
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const inputPromise = client.sendTerminalInput(
      'term_1',
      new TextEncoder().encode('\r'),
      'submit',
      'fix the build'
    );

    const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === 'string');
    const command = sentStrings.map((entry) => JSON.parse(entry)).find((entry) => entry.op === 'terminal.input');

    expect(command).toMatchObject({
      kind: 'command',
      op: 'terminal.input',
      args: {
        terminalId: 'term_1',
        transport: 'binary',
        activity: 'submit',
        submittedText: 'fix the build',
      },
    });

    socket.triggerMessage({
      kind: 'result',
      id: command.id,
      ok: true,
      data: undefined,
    });

    await expect(inputPromise).resolves.toBeUndefined();
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

  it('uses the configured development WebSocket URL when provided', () => {
    vi.stubEnv('VITE_BACKEND_WS_URL', 'ws://127.0.0.1:43173/ws');

    expect(resolveWsUrl()).toBe('ws://127.0.0.1:43173/ws');
  });

  it('appends the WebSocket path when the configured development URL is host-only', () => {
    vi.stubEnv('VITE_BACKEND_WS_URL', 'ws://127.0.0.1:43173');

    expect(resolveWsUrl()).toBe('ws://127.0.0.1:43173/ws');
  });
});
