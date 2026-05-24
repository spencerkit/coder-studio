/**
 * Tests for WebSocket Client
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { WsClient } from "../ws/client.js";

describe("WsClient", () => {
  type MockSocket = {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    bufferedAmount: number;
  };

  let mockSocket: MockSocket;
  let client: WsClient;
  let logger: { warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      bufferedAmount: 0,
    };

    logger = {
      warn: vi.fn(),
    };

    client = new WsClient(mockSocket, "test-client-id", logger);
  });

  it("passes binary websocket messages through as buffers", () => {
    const handler = vi.fn();
    client.onMessage(handler);

    const messageHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === "message"
    )?.[1];
    const payload = Buffer.from([1, 2, 3]);
    messageHandler?.(payload, true);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("should create client with id", () => {
    expect(client.id).toBe("test-client-id");
  });

  it("should send message successfully", () => {
    const msg = {
      kind: "event",
      topic: "test.topic",
      seq: 1,
      timestamp: Date.now(),
      data: { test: "data" },
    };

    const result = client.send(msg);

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("should not send when socket not open", () => {
    mockSocket.readyState = WebSocket.CLOSED;

    const result = client.send({ kind: "event", topic: "test", seq: 1, timestamp: 0, data: {} });

    expect(result).toBe(false);
    expect(mockSocket.send).not.toHaveBeenCalled();
  });

  it("sendControl never drops on bufferedAmount (control class is unconditional)", () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024; // way above the old 1MiB threshold

    const result = client.sendControl({
      kind: "event",
      topic: "test",
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("send() is an alias for sendControl()", () => {
    mockSocket.bufferedAmount = 8 * 1024 * 1024;

    const result = client.send({
      kind: "event",
      topic: "test",
      seq: 1,
      timestamp: 0,
      data: {},
    });

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("should subscribe to topics", () => {
    client.subscribe(["workspace.42.*", "session.test.state"]);

    expect(client.subscribesTo("workspace.42.meta")).toBe(true);
    expect(client.subscribesTo("workspace.42.session.test.state")).toBe(true);
    expect(client.subscribesTo("workspace.41.meta")).toBe(false);
  });

  it("should unsubscribe from topics", () => {
    client.subscribe(["workspace.42.*"]);
    client.unsubscribe(["workspace.42.*"]);

    expect(client.subscribesTo("workspace.42.meta")).toBe(false);
  });

  it("should match glob patterns", () => {
    client.subscribe(["workspace.*"]);

    expect(client.subscribesTo("workspace.42")).toBe(true);
    expect(client.subscribesTo("workspace.42.session")).toBe(true);
    expect(client.subscribesTo("session.test")).toBe(false);
  });

  it("should send event", () => {
    const result = client.sendEvent("test.topic", { data: "test" }, 1);

    expect(result).toBe(true);
    expect(mockSocket.send).toHaveBeenCalledWith(expect.stringContaining("test.topic"));
  });

  it("should ping client", () => {
    client.ping();

    expect(mockSocket.ping).toHaveBeenCalled();
  });

  it("should close client", () => {
    client.close(1000, "normal");

    expect(mockSocket.close).toHaveBeenCalledWith(1000, "normal");
  });

  describe("stream path", () => {
    const HIGH = 1024 * 1024;
    const LOW = 256 * 1024;
    const sample = { kind: "event", topic: "t", seq: 0, timestamp: 0, data: {} } as const;

    it("sendStream below HIGH water sends directly", () => {
      mockSocket.bufferedAmount = 0;
      client.sendStream("workspace.x.terminal.t1.output", sample);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
    });

    it("sendStream keeps sending directly below the tuned 1MiB HIGH water mark", () => {
      mockSocket.bufferedAmount = 768 * 1024;
      client.sendStream("workspace.x.terminal.t1.output", sample);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
    });

    it("sendStream sends binary buffers as websocket binary frames", () => {
      const payload = Buffer.from([1, 2, 3]);
      client.sendStream("workspace.x.terminal.t1.output", payload);

      expect(mockSocket.send).toHaveBeenCalledWith(payload, { binary: true });
    });

    it("sendStream at or above HIGH water defers to the buffer and starts the flush timer", () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.x.terminal.t1.output", sample);
      expect(mockSocket.send).not.toHaveBeenCalled();

      // Drop below LOW and tick the flush timer
      mockSocket.bufferedAmount = LOW - 1;
      vi.advanceTimersByTime(40);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("clears the flush timer once the buffer is drained", () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.x.terminal.t1.output", sample);

      mockSocket.bufferedAmount = 0;
      vi.advanceTimersByTime(40);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);

      // Another tick after queue is empty: must not produce more sends
      mockSocket.send.mockClear();
      vi.advanceTimersByTime(200);
      expect(mockSocket.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("isolates topics: a noisy topic does not block another topic from sending", () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.x.terminal.A.output", { ...sample, data: { id: "A" } });
      client.sendStream("workspace.x.terminal.B.output", { ...sample, data: { id: "B" } });

      mockSocket.bufferedAmount = 0;
      vi.advanceTimersByTime(40);

      const sentTopics = mockSocket.send.mock.calls.map(
        ([raw]: [string]) => JSON.parse(raw).data.id
      );
      expect(sentTopics).toEqual(["A", "B"]);
      vi.useRealTimers();
    });

    it("control sends remain unaffected when the stream buffer is busy", () => {
      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.x.terminal.t1.output", sample);
      mockSocket.send.mockClear();

      const ok = client.sendControl({
        kind: "event",
        topic: "workspace.x.session.s1.state",
        seq: 0,
        timestamp: 0,
        data: { state: "running" },
      });

      expect(ok).toBe(true);
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
    });

    it("close clears the flush timer and destroys the buffer", () => {
      vi.useFakeTimers();
      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.x.terminal.t1.output", sample);

      // Simulate ws emitting 'close'
      const closeHandler = mockSocket.on.mock.calls.find(
        (call: unknown[]) => call[0] === "close"
      )?.[1];
      mockSocket.readyState = WebSocket.CLOSED;
      closeHandler?.();

      mockSocket.send.mockClear();
      vi.advanceTimersByTime(200);
      expect(mockSocket.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("warns when stream frames are dropped due to buffer pressure", () => {
      mockSocket.bufferedAmount = HIGH;

      const payload = Buffer.alloc(400 * 1024, 1);
      client.sendStream("workspace.x.terminal.t1.output", payload);
      client.sendStream("workspace.x.terminal.t1.output", payload);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "topic-cap",
          clientId: "test-client-id",
          topic: "workspace.x.terminal.t1.output",
          droppedFrames: 1,
          evictedTopics: 0,
        }),
        "Stream buffer pressure"
      );
    });

    it("invokes a continuity callback when a terminal stream frame is dropped", () => {
      const onTerminalContinuityLost = vi.fn();
      client = new WsClient(mockSocket, "test-client-id", logger, {
        onTerminalContinuityLost,
      });

      mockSocket.bufferedAmount = HIGH;
      client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.from("aaaa"));
      client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.from("bbbb"));
      client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.alloc(600 * 1024, 1));

      expect(onTerminalContinuityLost).toHaveBeenCalledWith({
        clientId: "test-client-id",
        topic: "workspace.ws-1.terminal.term-1.output",
        reason: "stream_drop",
      });
    });
  });
});
