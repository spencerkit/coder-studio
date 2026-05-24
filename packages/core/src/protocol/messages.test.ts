import { describe, expect, it } from "vitest";
import {
  decodeTerminalBinaryFrame,
  decodeTerminalOutputFrame,
  encodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  type RecoveryReconcileDecision,
  type RecoveryReconcileRequest,
  TERMINAL_BINARY_OUTPUT_VERSION,
  TERMINAL_BINARY_PROTOCOL_VERSION,
  TerminalBinaryFrameType,
  type TerminalContinuityLostEvent,
} from "./messages";
import { Topics } from "./topics";

describe("Protocol schemas", () => {
  it("placeholder test", () => {
    expect(true).toBe(true);
  });
});

describe("v2 terminal output frame codec", () => {
  it("round-trips topic, seq, streamId, and payload", () => {
    const payload = new Uint8Array([10, 20, 30]);
    const encoded = encodeTerminalOutputFrame(
      { topic: "workspace.1.terminal.t1.output", seq: 42, streamId: 7, payloadSize: 3 },
      payload
    );
    const decoded = decodeTerminalOutputFrame(encoded);
    expect(decoded.topic).toBe("workspace.1.terminal.t1.output");
    expect(decoded.seq).toBe(42);
    expect(decoded.streamId).toBe(7);
    expect(decoded.payload).toEqual(payload);
  });

  it("sets version byte to TERMINAL_BINARY_OUTPUT_VERSION", () => {
    const encoded = encodeTerminalOutputFrame(
      { topic: "t", seq: 0, streamId: 1, payloadSize: 1 },
      new Uint8Array([0xff])
    );
    expect(encoded[0]).toBe(TERMINAL_BINARY_OUTPUT_VERSION);
    expect(TERMINAL_BINARY_OUTPUT_VERSION).toBe(2);
  });

  it("handles empty payload", () => {
    const encoded = encodeTerminalOutputFrame(
      { topic: "workspace.x.terminal.y.output", seq: 1, streamId: 2, payloadSize: 0 },
      new Uint8Array(0)
    );
    const decoded = decodeTerminalOutputFrame(encoded);
    expect(decoded.payload.byteLength).toBe(0);
    expect(decoded.topic).toBe("workspace.x.terminal.y.output");
  });

  it("throws on version mismatch", () => {
    const encoded = encodeTerminalOutputFrame(
      { topic: "t", seq: 0, streamId: 1, payloadSize: 0 },
      new Uint8Array(0)
    );
    const bad = new Uint8Array(encoded);
    bad[0] = 1;
    expect(() => decodeTerminalOutputFrame(bad)).toThrow("Expected output frame version");
  });

  it("throws when frame is too short", () => {
    expect(() => decodeTerminalOutputFrame(new Uint8Array(5))).toThrow("too short");
  });

  it("throws on payload size mismatch", () => {
    const encoded = encodeTerminalOutputFrame(
      { topic: "a", seq: 0, streamId: 1, payloadSize: 4 },
      new Uint8Array([1, 2, 3, 4])
    );
    expect(() => decodeTerminalOutputFrame(encoded.subarray(0, encoded.length - 1))).toThrow(
      "payload length mismatch"
    );
  });
});

describe("terminal binary frame codec", () => {
  it("decodes snapshot frames with metadata intact", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const encoded = encodeTerminalBinaryFrame(
      {
        version: TERMINAL_BINARY_PROTOCOL_VERSION,
        type: TerminalBinaryFrameType.Snapshot,
        flags: 0,
        meta: 123,
        streamId: 9,
        payloadSize: payload.byteLength,
      },
      payload
    );

    const decoded = decodeTerminalBinaryFrame(encoded);

    expect(decoded.header.version).toBe(TERMINAL_BINARY_PROTOCOL_VERSION);
    expect(decoded.header.type).toBe(TerminalBinaryFrameType.Snapshot);
    expect(decoded.header.meta).toBe(123);
    expect(decoded.header.streamId).toBe(9);
    expect(decoded.payload).toEqual(payload);
  });
});

describe("terminal recovery protocol types", () => {
  it("exports a terminal continuity topic builder", () => {
    expect(Topics.terminalContinuityLost("ws-1", "term-1")).toBe(
      "workspace.ws-1.terminal.term-1.continuity_lost"
    );
  });

  it("accepts a recovery reconcile request shape", () => {
    const request: RecoveryReconcileRequest = {
      reason: "foreground_resume",
      terminals: [
        {
          terminalId: "term-1",
          renderedSeq: 128,
        },
      ],
    };

    expect(request.terminals[0]?.renderedSeq).toBe(128);
  });

  it("supports the full reconcile decision union", () => {
    const decisions: RecoveryReconcileDecision[] = [
      { terminalId: "term-noop", action: "noop", headSeq: 10 },
      { terminalId: "term-replay", action: "replay", fromSeq: 4, headSeq: 10 },
      { terminalId: "term-snapshot", action: "snapshot", headSeq: 10 },
      { terminalId: "term-closed", action: "closed", headSeq: 10, exitCode: 0 },
      {
        terminalId: "term-bad",
        action: "unrecoverable",
        reason: "too_old_no_snapshot",
      },
    ];

    expect(decisions.map((entry) => entry.action)).toEqual([
      "noop",
      "replay",
      "snapshot",
      "closed",
      "unrecoverable",
    ]);
  });

  it("models terminal continuity lost control events", () => {
    const event: TerminalContinuityLostEvent = {
      workspaceId: "ws-1",
      terminalId: "term-1",
      reason: "stream_drop",
    };

    expect(event.reason).toBe("stream_drop");
  });
});
