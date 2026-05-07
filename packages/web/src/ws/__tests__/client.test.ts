import {
  encodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TerminalBinaryFrameType,
} from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWsUrl, WsClient } from "../client";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  url: string;
  binaryType: BinaryType = "blob";
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

  close(code = 1000, reason = "") {
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

  triggerClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

describe("web WsClient", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    globalThis.WebSocket = originalWebSocket;
  });

  it("sets websocket binaryType to arraybuffer on connect", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    expect(socket.binaryType).toBe("arraybuffer");

    socket.triggerOpen();
    await connectPromise;
  });

  it("reuses the in-flight connect attempt when connect is called again before the socket opens", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");

    const firstConnectPromise = client.connect();
    const secondConnectPromise = client.connect();

    expect(MockWebSocket.instances).toHaveLength(1);

    let firstSettled = false;
    let secondSettled = false;
    firstConnectPromise.finally(() => {
      firstSettled = true;
    });
    secondConnectPromise.finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    MockWebSocket.instances[0]!.triggerOpen();

    await expect(Promise.all([firstConnectPromise, secondConnectPromise])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("handles v2 output frame: routes directly to topic without waiting for JSON event", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const handler = vi.fn();

    client.subscribe(["workspace.w1.terminal.t1.output"], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const payloadBytes = new Uint8Array([65, 66, 67]);
    const frame = encodeTerminalOutputFrame(
      { topic: "workspace.w1.terminal.t1.output", seq: 99, streamId: 5, payloadSize: 3 },
      payloadBytes
    );
    socket.triggerBinaryMessage(frame);

    expect(handler).toHaveBeenCalledWith(
      "workspace.w1.terminal.t1.output",
      expect.objectContaining({
        transport: "binary",
        streamId: 5,
        size: 3,
        bytes: expect.any(Uint8Array),
      }),
      99
    );
    expect((handler.mock.calls[0] as [string, { bytes: Uint8Array }, number])[1].bytes).toEqual(
      payloadBytes
    );
  });

  it("reassembles terminal replay binary frames before resolving the command", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand<{
      status: "ok";
      transport: "binary";
      streamId: number;
      size: number;
      seq: number;
      bytes: Uint8Array;
    }>("terminal.replay", { terminalId: "term_1" });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === "command" && entry.op === "terminal.replay");

    expect(command).toBeTruthy();

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: {
        status: "ok",
        transport: "binary",
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
        new TextEncoder().encode("replay")
      )
    );

    await replayPromise.then((result) => {
      expect(result).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: 21,
        size: 6,
        seq: 9,
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode("replay")));
    });
  });

  it("allows terminal.replay to use a longer custom timeout without changing the default command timeout", async () => {
    vi.useFakeTimers();

    const client = new WsClient("ws://localhost:3000/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand(
      "terminal.replay",
      { terminalId: "term_1" },
      { timeoutMs: 120_000 }
    );
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

    await expect(replayPromise).rejects.toThrow("Command timeout: terminal.replay");
    await handledReplayPromise;

    vi.useRealTimers();
  });

  it("reassembles terminal replay when the binary frame arrives before the result", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const replayPromise = client.sendCommand<{
      status: "ok";
      transport: "binary";
      streamId: number;
      size: number;
      seq: number;
      bytes: Uint8Array;
    }>("terminal.replay", { terminalId: "term_1" });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === "command" && entry.op === "terminal.replay");

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
        new TextEncoder().encode("replay")
      )
    );

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: {
        status: "ok",
        transport: "binary",
        streamId: 31,
        size: 6,
        seq: 9,
      },
    });

    await replayPromise.then((result) => {
      expect(result).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: 31,
        size: 6,
        seq: 9,
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode("replay")));
    });
  });

  it("reassembles terminal snapshot binary frames before resolving the command", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const snapshotPromise = client.sendCommand<{
      status: "ok";
      transport: "binary";
      streamId: number;
      size: number;
      seq: number;
      cols: number;
      rows: number;
      source: "headless";
      bytes: Uint8Array;
    }>("terminal.snapshot", { terminalId: "term_1" });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

    expect(command).toBeTruthy();

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: {
        status: "ok",
        transport: "binary",
        streamId: 41,
        size: 8,
        seq: 13,
        cols: 120,
        rows: 30,
        source: "headless",
      },
    });

    socket.triggerBinaryMessage(
      encodeTerminalBinaryFrame(
        {
          version: TERMINAL_BINARY_PROTOCOL_VERSION,
          type: TerminalBinaryFrameType.Snapshot,
          flags: 0,
          meta: 13,
          streamId: 41,
          payloadSize: 8,
        },
        new TextEncoder().encode("snapshot")
      )
    );

    await snapshotPromise.then((result) => {
      expect(result).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: 41,
        size: 8,
        seq: 13,
        cols: 120,
        rows: 30,
        source: "headless",
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode("snapshot")));
    });
  });

  it("reassembles terminal snapshot when the binary frame arrives before the result", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const snapshotPromise = client.sendCommand<{
      status: "ok";
      transport: "binary";
      streamId: number;
      size: number;
      seq: number;
      cols: number;
      rows: number;
      source: "headless";
      bytes: Uint8Array;
    }>("terminal.snapshot", { terminalId: "term_1" });

    const command = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

    expect(command).toBeTruthy();

    socket.triggerBinaryMessage(
      encodeTerminalBinaryFrame(
        {
          version: TERMINAL_BINARY_PROTOCOL_VERSION,
          type: TerminalBinaryFrameType.Snapshot,
          flags: 0,
          meta: 13,
          streamId: 51,
          payloadSize: 8,
        },
        new TextEncoder().encode("snapshot")
      )
    );

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: {
        status: "ok",
        transport: "binary",
        streamId: 51,
        size: 8,
        seq: 13,
        cols: 120,
        rows: 30,
        source: "headless",
      },
    });

    await snapshotPromise.then((result) => {
      expect(result).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: 51,
        size: 8,
        seq: 13,
        cols: 120,
        rows: 30,
        source: "headless",
      });
      expect(result.bytes).toEqual(new Uint8Array(new TextEncoder().encode("snapshot")));
    });
  });

  it("drops mismatched binary frame types without resolving the command", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      const snapshotPromise = client.sendCommand(
        "terminal.snapshot",
        { terminalId: "term_1" },
        { timeoutMs: 50 }
      );
      const handledPromise = snapshotPromise.catch((error) => error);

      const command = socket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

      socket.triggerMessage({
        kind: "result",
        id: command.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 61,
          size: 6,
          seq: 13,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });

      socket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Replay,
            flags: 0,
            meta: 13,
            streamId: 61,
            payloadSize: 6,
          },
          new TextEncoder().encode("replay")
        )
      );

      await vi.advanceTimersByTimeAsync(51);

      await expect(snapshotPromise).rejects.toThrow("Command timeout: terminal.snapshot");
      await handledPromise;
      expect(warnSpy).toHaveBeenCalledWith(
        "Discarding terminal binary frame with unexpected type",
        expect.objectContaining({
          streamId: 61,
          expectedFrameType: TerminalBinaryFrameType.Snapshot,
          actualFrameType: TerminalBinaryFrameType.Replay,
        })
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("cleans up pending binary command state when metadata arrives but payload never does", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      const snapshotPromise = client.sendCommand(
        "terminal.snapshot",
        { terminalId: "term_1" },
        { timeoutMs: 50 }
      );
      const handledPromise = snapshotPromise.catch((error) => error);

      const command = socket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

      socket.triggerMessage({
        kind: "result",
        id: command.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 71,
          size: 8,
          seq: 13,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });

      await vi.advanceTimersByTimeAsync(51);

      await expect(snapshotPromise).rejects.toThrow("Command timeout: terminal.snapshot");
      await handledPromise;
      expect(
        (client as { pendingBinaryStreamIds: Map<number, unknown> }).pendingBinaryStreamIds.size
      ).toBe(0);
      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(0);

      const retryPromise = client.sendCommand<{
        status: "ok";
        transport: "binary";
        streamId: number;
        size: number;
        seq: number;
        cols: number;
        rows: number;
        source: "headless";
        bytes: Uint8Array;
      }>("terminal.snapshot", { terminalId: "term_1" });
      const retryCommand = socket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .filter((entry) => entry.kind === "command" && entry.op === "terminal.snapshot")
        .at(-1);

      socket.triggerMessage({
        kind: "result",
        id: retryCommand.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 72,
          size: 5,
          seq: 14,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });
      socket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 14,
            streamId: 72,
            payloadSize: 5,
          },
          new TextEncoder().encode("fresh")
        )
      );

      await expect(retryPromise).resolves.toMatchObject({
        streamId: 72,
        seq: 14,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires orphan binary payloads when no matching command result arrives", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      socket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 13,
            streamId: 81,
            payloadSize: 8,
          },
          new TextEncoder().encode("snapshot")
        )
      );

      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(1);

      await vi.advanceTimersByTimeAsync(30_001);

      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(0);

      const snapshotPromise = client.sendCommand<{
        status: "ok";
        transport: "binary";
        streamId: number;
        size: number;
        seq: number;
        cols: number;
        rows: number;
        source: "headless";
        bytes: Uint8Array;
      }>("terminal.snapshot", { terminalId: "term_1" });
      const command = socket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .filter((entry) => entry.kind === "command" && entry.op === "terminal.snapshot")
        .at(-1);

      socket.triggerMessage({
        kind: "result",
        id: command.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 82,
          size: 5,
          seq: 14,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });
      socket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 14,
            streamId: 82,
            payloadSize: 5,
          },
          new TextEncoder().encode("fresh")
        )
      );

      await expect(snapshotPromise).resolves.toMatchObject({
        streamId: 82,
        seq: 14,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores late snapshot payloads from an old socket after reconnect", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const firstSocket = MockWebSocket.instances[0]!;
      firstSocket.triggerOpen();
      await connectPromise;

      const snapshotPromise = client.sendCommand("terminal.snapshot", { terminalId: "term_1" });
      const handledSnapshotPromise = snapshotPromise.catch((error) => error);

      const firstCommand = firstSocket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

      firstSocket.triggerMessage({
        kind: "result",
        id: firstCommand.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 91,
          size: 3,
          seq: 10,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });

      expect(
        (client as { pendingBinaryStreamIds: Map<number, unknown> }).pendingBinaryStreamIds.size
      ).toBe(1);

      client.disconnect("manual_reset");

      await expect(snapshotPromise).rejects.toThrow("WebSocket disconnected");
      await handledSnapshotPromise;
      expect(
        (client as { pendingBinaryStreamIds: Map<number, unknown> }).pendingBinaryStreamIds.size
      ).toBe(0);
      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(0);

      const reconnectPromise = client.connect();
      const secondSocket = MockWebSocket.instances.at(-1)!;
      secondSocket.triggerOpen();
      await reconnectPromise;

      firstSocket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 10,
            streamId: 91,
            payloadSize: 3,
          },
          new TextEncoder().encode("old")
        )
      );

      const retryPromise = client.sendCommand<{
        status: "ok";
        transport: "binary";
        streamId: number;
        size: number;
        seq: number;
        cols: number;
        rows: number;
        source: "headless";
        bytes: Uint8Array;
      }>("terminal.snapshot", { terminalId: "term_1" });
      const retryCommand = secondSocket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .filter((entry) => entry.kind === "command" && entry.op === "terminal.snapshot")
        .at(-1);

      secondSocket.triggerMessage({
        kind: "result",
        id: retryCommand.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 92,
          size: 5,
          seq: 11,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });
      secondSocket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 11,
            streamId: 92,
            payloadSize: 5,
          },
          new TextEncoder().encode("fresh")
        )
      );

      await expect(retryPromise).resolves.toMatchObject({
        streamId: 92,
        seq: 11,
        bytes: new Uint8Array(new TextEncoder().encode("fresh")),
      });
      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores late JSON and binary messages from an unexpectedly closed socket after auto reconnect", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws", {
        baseDelayMs: 10,
        maxDelayMs: 10,
      });
      const eventHandler = vi.fn();

      client.subscribe(["workspace.*"], eventHandler);

      const connectPromise = client.connect();
      const firstSocket = MockWebSocket.instances[0]!;
      firstSocket.triggerOpen();
      await connectPromise;

      const snapshotPromise = client.sendCommand("terminal.snapshot", { terminalId: "term_1" });
      const handledSnapshotPromise = snapshotPromise.catch((error) => error);

      const firstCommand = firstSocket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.kind === "command" && entry.op === "terminal.snapshot");

      firstSocket.triggerMessage({
        kind: "result",
        id: firstCommand.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 191,
          size: 3,
          seq: 20,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });

      firstSocket.triggerClose(1006, "network_lost");

      await expect(snapshotPromise).rejects.toThrow("WebSocket disconnected");
      await handledSnapshotPromise;
      expect(client.getStatus()).toBe("reconnecting");

      await vi.advanceTimersByTimeAsync(10);

      const secondSocket = MockWebSocket.instances[1]!;

      firstSocket.triggerMessage({
        kind: "event",
        topic: "workspace.ws_1.session.sess_1.state",
        seq: 99,
        timestamp: Date.now(),
        data: { state: "stale" },
      });
      firstSocket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 20,
            streamId: 191,
            payloadSize: 3,
          },
          new TextEncoder().encode("old")
        )
      );

      expect(eventHandler).not.toHaveBeenCalled();
      expect(
        (client as { orphanBinaryPayloads: Map<number, unknown> }).orphanBinaryPayloads.size
      ).toBe(0);

      secondSocket.triggerOpen();
      await Promise.resolve();

      const retryPromise = client.sendCommand<{
        status: "ok";
        transport: "binary";
        streamId: number;
        size: number;
        seq: number;
        cols: number;
        rows: number;
        source: "headless";
        bytes: Uint8Array;
      }>("terminal.snapshot", { terminalId: "term_1" });
      const retryCommand = secondSocket.sent
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => JSON.parse(entry))
        .filter((entry) => entry.kind === "command" && entry.op === "terminal.snapshot")
        .at(-1);

      secondSocket.triggerMessage({
        kind: "result",
        id: retryCommand.id,
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 192,
          size: 5,
          seq: 21,
          cols: 120,
          rows: 30,
          source: "headless",
        },
      });
      secondSocket.triggerBinaryMessage(
        encodeTerminalBinaryFrame(
          {
            version: TERMINAL_BINARY_PROTOCOL_VERSION,
            type: TerminalBinaryFrameType.Snapshot,
            flags: 0,
            meta: 21,
            streamId: 192,
            payloadSize: 5,
          },
          new TextEncoder().encode("fresh")
        )
      );

      await expect(retryPromise).resolves.toMatchObject({
        streamId: 192,
        seq: 21,
        bytes: new Uint8Array(new TextEncoder().encode("fresh")),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("v2 output frame does not require a prior JSON event", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const handler = vi.fn();

    client.subscribe(["workspace.w1.terminal.t1.output"], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const frame = encodeTerminalOutputFrame(
      { topic: "workspace.w1.terminal.t1.output", seq: 1, streamId: 1, payloadSize: 1 },
      new Uint8Array([42])
    );
    socket.triggerBinaryMessage(frame);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generated UUID when crypto.randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
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
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      const commandPromise = client.sendCommand("workspace.list", {});

      const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === "string");
      const command = sentStrings
        .map((entry) => JSON.parse(entry))
        .find((entry) => entry.op === "workspace.list");

      expect(command.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      socket.triggerMessage({
        kind: "result",
        id: command.id,
        ok: true,
        data: { ok: true },
      });

      await expect(commandPromise).resolves.toEqual({ ok: true });
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it("sends terminal input as metadata plus binary payload", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const inputPromise = client.sendTerminalInput(
      "term_1",
      new TextEncoder().encode("你好"),
      "typing"
    );

    const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === "string");
    const command = sentStrings
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.op === "terminal.input");

    expect(command).toMatchObject({
      kind: "command",
      op: "terminal.input",
      args: {
        terminalId: "term_1",
        transport: "binary",
        streamId: expect.any(Number),
        size: new TextEncoder().encode("你好").byteLength,
        activity: "typing",
      },
    });

    const sentBinary = socket.sent.find(
      (entry) =>
        entry instanceof Uint8Array || ArrayBuffer.isView(entry) || entry instanceof ArrayBuffer
    );
    expect(sentBinary).toBeTruthy();

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: undefined,
    });

    await expect(inputPromise).resolves.toBeUndefined();
  });

  it("includes submittedText metadata for submit activity terminal input", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const inputPromise = client.sendTerminalInput(
      "term_1",
      new TextEncoder().encode("\r"),
      "submit",
      "fix the build"
    );

    const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === "string");
    const command = sentStrings
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.op === "terminal.input");

    expect(command).toMatchObject({
      kind: "command",
      op: "terminal.input",
      args: {
        terminalId: "term_1",
        transport: "binary",
        activity: "submit",
        submittedText: "fix the build",
      },
    });

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: undefined,
    });

    await expect(inputPromise).resolves.toBeUndefined();
  });

  it("includes control activity metadata for ctrl-modified terminal input", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const inputPromise = client.sendTerminalInput(
      "term_1",
      new TextEncoder().encode("\x03"),
      "control"
    );

    const sentStrings = socket.sent.filter((entry): entry is string => typeof entry === "string");
    const command = sentStrings
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.op === "terminal.input");

    expect(command).toMatchObject({
      kind: "command",
      op: "terminal.input",
      args: {
        terminalId: "term_1",
        transport: "binary",
        activity: "control",
      },
    });
    expect(command.args).not.toHaveProperty("submittedText");

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: true,
      data: undefined,
    });

    await expect(inputPromise).resolves.toBeUndefined();
  });

  it("resends subscribed topics when the socket opens", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const handler = vi.fn();

    client.subscribe(["workspace.*", "connection.*"], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    socket.triggerOpen();
    await connectPromise;

    expect(socket.sent).toContain(
      JSON.stringify({
        kind: "subscribe",
        topics: ["workspace.*", "connection.*"],
      })
    );
  });

  it("tracks reconnecting as the current client status after an unexpected close", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const socket = MockWebSocket.instances[0]!;
      socket.triggerOpen();
      await connectPromise;

      socket.triggerClose(1006, "network_lost");

      expect(client.getStatus()).toBe("reconnecting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("can bypass reconnect backoff and reconnect immediately when recovery is requested", async () => {
    vi.useFakeTimers();

    try {
      const client = new WsClient("ws://127.0.0.1:4173/ws");
      const connectPromise = client.connect();
      const firstSocket = MockWebSocket.instances[0]!;
      firstSocket.triggerOpen();
      await connectPromise;

      firstSocket.triggerClose(1006, "network_lost");

      expect(MockWebSocket.instances).toHaveLength(1);

      client.recoverConnection("visibility_resume");

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(client.getStatus()).toBe("connecting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches wildcard subscriptions for nested workspace events", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const handler = vi.fn();

    client.subscribe(["workspace.*"], handler);
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;

    socket.triggerOpen();
    await connectPromise;

    socket.triggerMessage({
      kind: "event",
      topic: "workspace.ws_1.session.sess_1.state",
      seq: 3,
      timestamp: Date.now(),
      data: { state: "starting" },
    });

    expect(handler).toHaveBeenCalledWith(
      "workspace.ws_1.session.sess_1.state",
      { state: "starting" },
      3
    );
  });

  it("uses the configured development WebSocket URL when provided", () => {
    vi.stubEnv("VITE_BACKEND_WS_URL", "ws://127.0.0.1:43173/ws");

    expect(resolveWsUrl()).toBe("ws://127.0.0.1:43173/ws");
  });

  it("preserves command error code and details when the server rejects a command", async () => {
    const client = new WsClient("ws://127.0.0.1:4173/ws");
    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.triggerOpen();
    await connectPromise;

    const promise = client.sendCommand("provider.install.start", { providerId: "codex" });
    const command = socket.sent
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.kind === "command" && entry.op === "provider.install.start");

    expect(command).toBeTruthy();

    socket.triggerMessage({
      kind: "result",
      id: command.id,
      ok: false,
      error: {
        code: "provider_cli_missing",
        message: "Provider CLI is not installed",
        details: {
          providerId: "codex",
          missingCommands: ["codex"],
        },
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: "provider_cli_missing",
      details: {
        providerId: "codex",
        missingCommands: ["codex"],
      },
    });
  });

  it("appends the WebSocket path when the configured development URL is host-only", () => {
    vi.stubEnv("VITE_BACKEND_WS_URL", "ws://127.0.0.1:43173");

    expect(resolveWsUrl()).toBe("ws://127.0.0.1:43173/ws");
  });

  it("uses the current browser origin in development when no backend URL is configured", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        host: "localhost:5173",
      },
    });

    expect(resolveWsUrl()).toBe("ws://localhost:5173/ws");
  });

  it("falls back to the local backend URL when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(resolveWsUrl()).toBe("ws://127.0.0.1:4173/ws");
  });
});
