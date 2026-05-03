import { z } from 'zod';

export const TERMINAL_BINARY_PROTOCOL_VERSION = 1;
export const TERMINAL_BINARY_HEADER_SIZE = 16;

export const TerminalBinaryFrameType = {
  Output: 1,
  Replay: 2,
  Input: 3,
  Snapshot: 4,
} as const;

export type TerminalBinaryFrameType =
  (typeof TerminalBinaryFrameType)[keyof typeof TerminalBinaryFrameType];

export interface TerminalBinaryFrameHeader {
  version: number;
  type: TerminalBinaryFrameType;
  flags: number;
  meta: number;
  streamId: number;
  payloadSize: number;
}

export interface TerminalBinaryEventData {
  transport: 'binary';
  streamId: number;
  size: number;
}

export interface TerminalReplayBinaryResult {
  status: 'ok';
  transport: 'binary';
  streamId: number;
  size: number;
  seq: number;
}

export interface TerminalSnapshotBinaryResult {
  status: 'ok';
  transport: 'binary';
  streamId: number;
  size: number;
  seq: number;
  rows: number;
  cols: number;
  source: 'headless';
}

export interface TerminalInputBinaryArgs {
  terminalId: string;
  activity?: 'typing' | 'submit' | 'system';
  submittedText?: string;
  transport: 'binary';
  streamId: number;
  size: number;
}

export interface TerminalInputBase64Args {
  terminalId: string;
  bytes: string;
  activity?: 'typing' | 'submit' | 'system';
  submittedText?: string;
}

export const encodeTerminalBinaryFrame = (
  header: TerminalBinaryFrameHeader,
  payload: Uint8Array,
): Uint8Array => {
  if (payload.byteLength !== header.payloadSize) {
    throw new Error('Terminal binary payload size does not match header');
  }

  const frame = new Uint8Array(TERMINAL_BINARY_HEADER_SIZE + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, header.version);
  view.setUint8(1, header.type);
  view.setUint16(2, header.flags);
  view.setUint32(4, header.meta);
  view.setUint32(8, header.streamId);
  view.setUint32(12, header.payloadSize);
  frame.set(payload, TERMINAL_BINARY_HEADER_SIZE);
  return frame;
};

export const decodeTerminalBinaryFrame = (
  frame: ArrayBuffer | Uint8Array,
): {
  header: TerminalBinaryFrameHeader;
  payload: Uint8Array;
} => {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < TERMINAL_BINARY_HEADER_SIZE) {
    throw new Error('Terminal binary frame is too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header: TerminalBinaryFrameHeader = {
    version: view.getUint8(0),
    type: view.getUint8(1) as TerminalBinaryFrameType,
    flags: view.getUint16(2),
    meta: view.getUint32(4),
    streamId: view.getUint32(8),
    payloadSize: view.getUint32(12),
  };

  const payload = bytes.subarray(TERMINAL_BINARY_HEADER_SIZE);
  if (payload.byteLength !== header.payloadSize) {
    throw new Error('Terminal binary frame payload length mismatch');
  }

  return { header, payload };
};

export const TERMINAL_BINARY_OUTPUT_VERSION = 2;

export interface TerminalOutputFrameHeader {
  topic: string;
  seq: number;
  streamId: number;
  payloadSize: number;
}

export interface DecodedTerminalOutputFrame {
  topic: string;
  seq: number;
  streamId: number;
  payload: Uint8Array;
}

export const encodeTerminalOutputFrame = (
  header: TerminalOutputFrameHeader,
  payload: Uint8Array,
): Uint8Array => {
  if (payload.byteLength !== header.payloadSize) {
    throw new Error('Terminal output payload size does not match header');
  }

  const topicBytes = new TextEncoder().encode(header.topic);
  const frame = new Uint8Array(TERMINAL_BINARY_HEADER_SIZE + topicBytes.length + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, TERMINAL_BINARY_OUTPUT_VERSION);
  view.setUint8(1, TerminalBinaryFrameType.Output);
  view.setUint16(2, topicBytes.length, false);
  view.setUint32(4, header.seq, false);
  view.setUint32(8, header.streamId, false);
  view.setUint32(12, payload.byteLength, false);
  frame.set(topicBytes, TERMINAL_BINARY_HEADER_SIZE);
  frame.set(payload, TERMINAL_BINARY_HEADER_SIZE + topicBytes.length);
  return frame;
};

export const decodeTerminalOutputFrame = (
  frame: ArrayBuffer | Uint8Array,
): DecodedTerminalOutputFrame => {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < TERMINAL_BINARY_HEADER_SIZE) {
    throw new Error('Terminal output frame is too short');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== TERMINAL_BINARY_OUTPUT_VERSION) {
    throw new Error(
      `Expected output frame version ${TERMINAL_BINARY_OUTPUT_VERSION}, got ${version}`,
    );
  }

  const topicLength = view.getUint16(2, false);
  const seq = view.getUint32(4, false);
  const streamId = view.getUint32(8, false);
  const payloadSize = view.getUint32(12, false);
  if (bytes.byteLength < TERMINAL_BINARY_HEADER_SIZE + topicLength) {
    throw new Error('Terminal output frame topic is truncated');
  }

  const topic = new TextDecoder().decode(
    bytes.subarray(TERMINAL_BINARY_HEADER_SIZE, TERMINAL_BINARY_HEADER_SIZE + topicLength),
  );
  const payload = bytes.subarray(TERMINAL_BINARY_HEADER_SIZE + topicLength);
  if (payload.byteLength !== payloadSize) {
    throw new Error('Terminal output frame payload length mismatch');
  }

  return { topic, seq, streamId, payload };
};

// Command: client → server, expects Result
export const CommandMessage = z.object({
  kind: z.literal('command'),
  id: z.string().uuid(),
  op: z.string(),
  args: z.unknown(),
});

// Result: server → client, response to Command
export const ResultMessage = z.object({
  kind: z.literal('result'),
  id: z.string().uuid(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
});

// Event: server → client, unsolicited state change
export const EventMessage = z.object({
  kind: z.literal('event'),
  topic: z.string(),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  data: z.unknown(),
});

// Subscribe: client → server, declare interest in topics
export const SubscribeMessage = z.object({
  kind: z.literal('subscribe'),
  topics: z.array(z.string()),
});

// Unsubscribe: client → server, cancel interest
export const UnsubscribeMessage = z.object({
  kind: z.literal('unsubscribe'),
  topics: z.array(z.string()),
});

// Resync: client → server, request missed events after reconnect
export const ResyncMessage = z.object({
  kind: z.literal('resync'),
  lastSeen: z.record(z.string(), z.number()),
});

// Client → Server messages
export const ClientMessage = z.discriminatedUnion('kind', [
  CommandMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ResyncMessage,
]);

// Server → Client messages
export const ServerMessage = z.discriminatedUnion('kind', [ResultMessage, EventMessage]);

// Type exports
export type Command = z.infer<typeof CommandMessage>;
export type Result = z.infer<typeof ResultMessage>;
export type Event = z.infer<typeof EventMessage>;
export type Subscribe = z.infer<typeof SubscribeMessage>;
export type Unsubscribe = z.infer<typeof UnsubscribeMessage>;
export type Resync = z.infer<typeof ResyncMessage>;
export type ClientToServer = z.infer<typeof ClientMessage>;
export type ServerToClient = z.infer<typeof ServerMessage>;
