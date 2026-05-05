/**
 * WebSocket Client
 *
 * Handles WebSocket connection, command sending, event subscription, and reconnection.
 * Independent of React/Jotai - uses callbacks for integration.
 */

import {
  decodeTerminalBinaryFrame,
  decodeTerminalOutputFrame,
  TERMINAL_BINARY_OUTPUT_VERSION,
  TerminalBinaryFrameType,
  type TerminalInputActivity,
  type ClientToServer,
  type ServerToClient,
  type TerminalBinaryEventData,
  type TerminalReplayBinaryResult,
  type TerminalSnapshotBinaryResult,
} from '@coder-studio/core';
import { topicMatches } from './subscription';

export type TerminalBinaryPayload = TerminalBinaryEventData & { bytes: Uint8Array };
export type TerminalReplayPayload = TerminalReplayBinaryResult & { bytes: Uint8Array };
export type TerminalSnapshotPayload = TerminalSnapshotBinaryResult & { bytes: Uint8Array };
type TerminalCommandBinaryResult = TerminalReplayBinaryResult | TerminalSnapshotBinaryResult;
type TerminalCommandBinaryPayload = TerminalReplayPayload | TerminalSnapshotPayload;

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'rejected';

export type EventListener = (topic: string, payload: unknown, seq: number) => void;
export type StatusListener = (status: ConnectionStatus) => void;

export class CommandResultError extends Error {
  code: string;
  details?: unknown;

  constructor(error: { code: string; message: string; details?: unknown }) {
    super(error.message);
    this.name = 'CommandResultError';
    this.code = error.code;
    this.details = error.details;
  }
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  terminalBinary?: TerminalCommandBinaryResult;
  binaryStreamId?: number;
}

interface SendCommandOptions {
  timeoutMs?: number;
}

interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 30,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

const COMMAND_TIMEOUT_MS = 30000;

const createCommandId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
};

const normalizeWsUrl = (url: string): string => {
  return url.endsWith('/ws') ? url : `${url.replace(/\/+$/, '')}/ws`;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private connectDeferred: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private pendingCommands = new Map<string, PendingCommand>();
  private eventListeners = new Map<string, Set<EventListener>>();
  private statusListeners = new Set<StatusListener>();
  private lastSeenSeq = new Map<string, number>();
  private pendingBinaryStreamIds = new Map<
    number,
    { commandId: string; expectedFrameType: TerminalBinaryFrameType }
  >();
  // Binary frames can arrive ahead of their JSON metadata when the server
  // emits them in opposite order (e.g. terminal.replay sends the binary
  // before returning the result). We park orphan payloads here and consume
  // them once the matching metadata shows up.
  private orphanBinaryPayloads = new Map<
    number,
    { frameType: TerminalBinaryFrameType; bytes: Uint8Array; timeoutId: NodeJS.Timeout }
  >();
  private nextTerminalInputStreamId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isManualClose = false;
  private status: ConnectionStatus = 'disconnected';
  private url: string;
  private reconnectConfig: ReconnectConfig;

  constructor(
    url: string,
    reconnectConfig: Partial<ReconnectConfig> = {}
  ) {
    this.url = url;
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'connected') {
      return Promise.resolve();
    }

    if (this.connectDeferred) {
      return this.connectDeferred.promise;
    }

    this.isManualClose = false;
    this.setStatus('connecting');

    let resolveConnect!: () => void;
    let rejectConnect!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });
    this.connectDeferred = {
      promise,
      resolve: resolveConnect,
      reject: rejectConnect,
    };

    try {
      const socket = new WebSocket(this.url);
      this.ws = socket;
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        if (this.ws !== socket) {
          return;
        }

        this.setStatus('connected');
        this.reconnectAttempts = 0;

        const subscribedTopics = Array.from(this.eventListeners.keys());
        if (subscribedTopics.length > 0) {
          const msg: ClientToServer = { kind: 'subscribe', topics: subscribedTopics };
          socket.send(JSON.stringify(msg));
        }

        // Resync if we have lastSeen events
        if (this.lastSeenSeq.size > 0) {
          this.resync();
        }

        this.resolveConnectDeferred();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) {
          return;
        }

        try {
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data) as ServerToClient;
            this.handleMessage(msg);
            return;
          }

          if (event.data instanceof ArrayBuffer) {
            this.handleBinaryMessage(new Uint8Array(event.data));
            return;
          }

          console.error('Unsupported WebSocket message type:', typeof event.data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      socket.onclose = (event) => {
        if (this.ws !== socket) {
          return;
        }

        this.handleClose(event.code, event.reason);
        this.rejectConnectDeferred(new Error(`WebSocket closed: ${event.reason || event.code}`));
      };

      socket.onerror = (err) => {
        if (this.ws !== socket) {
          return;
        }

        console.error('WebSocket error:', err);
      };
    } catch (err) {
      this.rejectConnectDeferred(err instanceof Error ? err : new Error(String(err)));
    }

    return promise;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(reason?: string): void {
    this.isManualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.rejectConnectDeferred(new Error('WebSocket disconnected'));
    this.rejectPendingCommands(new Error('WebSocket disconnected'));
    this.clearBinaryCommandState();

    if (this.ws) {
      this.ws.close(1000, reason || 'client_disconnect');
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  recoverConnection(trigger: 'visibility_resume' | 'network_online' | 'manual_retry' = 'manual_retry'): void {
    const status = this.getStatus();
    if (status === 'connected' || status === 'connecting' || status === 'rejected') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts = 0;
    console.log(`[WsClient] Recovering connection after ${trigger}`);
    void this.connect().catch((err) => {
      console.error('Recovery connect failed:', err);
    });
  }

  async sendCommand<T>(op: string, args: unknown, options: SendCommandOptions = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = createCommandId();
      const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;

      const timeoutId = setTimeout(() => {
        this.cleanupTimedOutBinaryCommand(id);
        this.pendingCommands.delete(id);
        reject(new Error(`Command timeout: ${op}`));
      }, timeoutMs);

      this.pendingCommands.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      const msg: ClientToServer = { kind: 'command', id, op, args };
      this.ws.send(JSON.stringify(msg));
    });
  }

  async sendTerminalInput(
    terminalId: string,
    bytes: Uint8Array,
    activity?: TerminalInputActivity,
    submittedText?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = createCommandId();
      const streamId = this.allocateTerminalInputStreamId();
      const timeoutId = setTimeout(() => {
        this.cleanupTimedOutBinaryCommand(id);
        this.pendingCommands.delete(id);
        reject(new Error('Command timeout: terminal.input'));
      }, COMMAND_TIMEOUT_MS);

      this.pendingCommands.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      const msg: ClientToServer = {
        kind: 'command',
        id,
        op: 'terminal.input',
        args: {
          terminalId,
          transport: 'binary',
          streamId,
          size: bytes.byteLength,
          activity,
          submittedText,
        },
      };

      this.ws.send(JSON.stringify(msg));
      this.ws.send(bytes);
    });
  }

  /**
   * Subscribe to topics
   */
  subscribe(topics: string[], handler: EventListener): () => void {
    const newlyAddedTopics: string[] = [];

    for (const topic of topics) {
      if (!this.eventListeners.has(topic)) {
        this.eventListeners.set(topic, new Set());
        newlyAddedTopics.push(topic);
      }
      this.eventListeners.get(topic)!.add(handler);
    }

    // Send subscribe message
    if (newlyAddedTopics.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg: ClientToServer = { kind: 'subscribe', topics: newlyAddedTopics };
      this.ws.send(JSON.stringify(msg));
    }

    // Return unsubscribe function
    return () => {
      const removedTopics: string[] = [];

      for (const topic of topics) {
        const listeners = this.eventListeners.get(topic);
        if (!listeners) continue;

        listeners.delete(handler);
        if (listeners.size === 0) {
          this.eventListeners.delete(topic);
          removedTopics.push(topic);
        }
      }

      if (removedTopics.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const msg: ClientToServer = { kind: 'unsubscribe', topics: removedTopics };
        this.ws.send(JSON.stringify(msg));
      }
    };
  }

  /**
   * Add status listener
   */
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Get current status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  private handleMessage(msg: ServerToClient): void {
    if (msg.kind === 'result') {
        const pending = this.pendingCommands.get(msg.id);
      if (pending) {
        if (msg.ok && this.isTerminalBinaryCommandResult(msg.data)) {
          const expectedFrameType = this.getExpectedFrameType(msg.data);
          const orphan = this.orphanBinaryPayloads.get(msg.data.streamId);
          if (orphan) {
            this.orphanBinaryPayloads.delete(msg.data.streamId);
            clearTimeout(orphan.timeoutId);
            if (orphan.frameType === expectedFrameType) {
              clearTimeout(pending.timeoutId);
              this.pendingCommands.delete(msg.id);
              pending.resolve({
                ...msg.data,
                bytes: orphan.bytes,
              } satisfies TerminalCommandBinaryPayload);
              return;
            }

            console.warn('Discarding terminal binary frame with unexpected type', {
              streamId: msg.data.streamId,
              expectedFrameType,
              actualFrameType: orphan.frameType,
            });
          }
          pending.terminalBinary = msg.data;
          pending.binaryStreamId = msg.data.streamId;
          this.pendingBinaryStreamIds.set(msg.data.streamId, {
            commandId: msg.id,
            expectedFrameType,
          });
          return;
        }

        clearTimeout(pending.timeoutId);
        this.pendingCommands.delete(msg.id);

        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(
            new CommandResultError({
              code: msg.error?.code ?? 'command_failed',
              message: msg.error?.message ?? 'Command failed',
              details: msg.error?.details,
            }),
          );
        }
      }
    } else if (msg.kind === 'event') {
      this.lastSeenSeq.set(msg.topic, msg.seq);
      this.notifyEventListeners(msg.topic, msg.data, msg.seq);
    }
  }

  private handleBinaryMessage(frame: Uint8Array): void {
    if (frame.length === 0) return;

    if (frame[0] === TERMINAL_BINARY_OUTPUT_VERSION) {
      const decoded = decodeTerminalOutputFrame(frame);
      this.notifyEventListeners(
        decoded.topic,
        {
          transport: 'binary' as const,
          streamId: decoded.streamId,
          size: decoded.payload.byteLength,
          bytes: decoded.payload,
        } satisfies TerminalBinaryPayload,
        decoded.seq,
      );
      return;
    }

    const { header, payload } = decodeTerminalBinaryFrame(frame);

    const pendingInfo = this.pendingBinaryStreamIds.get(header.streamId);
    if (!pendingInfo) {
      const existingOrphan = this.orphanBinaryPayloads.get(header.streamId);
      if (existingOrphan) {
        clearTimeout(existingOrphan.timeoutId);
      }
      this.orphanBinaryPayloads.set(header.streamId, {
        frameType: header.type,
        bytes: payload,
        timeoutId: setTimeout(() => {
          this.orphanBinaryPayloads.delete(header.streamId);
        }, COMMAND_TIMEOUT_MS),
      });
      return;
    }

    if (header.type !== pendingInfo.expectedFrameType) {
      console.warn('Discarding terminal binary frame with unexpected type', {
        streamId: header.streamId,
        expectedFrameType: pendingInfo.expectedFrameType,
        actualFrameType: header.type,
      });
      return;
    }

    this.pendingBinaryStreamIds.delete(header.streamId);
    const pending = this.pendingCommands.get(pendingInfo.commandId);
    if (!pending?.terminalBinary) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingCommands.delete(pendingInfo.commandId);
    pending.resolve({
      ...pending.terminalBinary,
      bytes: payload,
    } satisfies TerminalCommandBinaryPayload);
  }

  private notifyEventListeners(topic: string, data: unknown, seq: number): void {
    for (const [pattern, listeners] of this.eventListeners.entries()) {
      if (!topicMatches(pattern, topic)) {
        continue;
      }

      for (const listener of listeners) {
        try {
          listener(topic, data, seq);
        } catch (err) {
          console.error(`Error in event listener for ${topic}:`, err);
        }
      }
    }
  }

  private isTerminalBinaryCommandResult(data: unknown): data is TerminalCommandBinaryResult {
    return (
      typeof data === 'object' &&
      data !== null &&
      'status' in data &&
      'transport' in data &&
      'streamId' in data &&
      'size' in data &&
      (data as { status?: unknown }).status === 'ok' &&
      (data as { transport?: unknown }).transport === 'binary'
    );
  }

  private getExpectedFrameType(data: TerminalCommandBinaryResult): TerminalBinaryFrameType {
    return 'source' in data ? TerminalBinaryFrameType.Snapshot : TerminalBinaryFrameType.Replay;
  }

  private cleanupTimedOutBinaryCommand(commandId: string): void {
    const pending = this.pendingCommands.get(commandId);
    const streamId = pending?.binaryStreamId;
    if (streamId == null) {
      return;
    }

    this.pendingBinaryStreamIds.delete(streamId);
    const orphan = this.orphanBinaryPayloads.get(streamId);
    if (orphan) {
      clearTimeout(orphan.timeoutId);
      this.orphanBinaryPayloads.delete(streamId);
    }
  }

  private clearBinaryCommandState(): void {
    this.pendingBinaryStreamIds.clear();
    for (const orphan of this.orphanBinaryPayloads.values()) {
      clearTimeout(orphan.timeoutId);
    }
    this.orphanBinaryPayloads.clear();
  }

  private resolveConnectDeferred(): void {
    const deferred = this.connectDeferred;
    if (!deferred) {
      return;
    }

    this.connectDeferred = null;
    deferred.resolve();
  }

  private rejectConnectDeferred(error: Error): void {
    const deferred = this.connectDeferred;
    if (!deferred) {
      return;
    }

    this.connectDeferred = null;
    deferred.reject(error);
  }

  private rejectPendingCommands(error: Error): void {
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pendingCommands.delete(id);
    }
  }

  private allocateTerminalInputStreamId(): number {
    const id = this.nextTerminalInputStreamId;
    this.nextTerminalInputStreamId += 1;
    return id;
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, _reason: string): void {
    this.ws = null;
    this.rejectPendingCommands(new Error('WebSocket disconnected'));
    this.clearBinaryCommandState();

    // Check for rejection codes
    if (code === 4001 || code === 4002) {
      // 4001: another_tab_active, 4002: takeover
      this.setStatus('rejected');
      return;
    }

    // Auto-reconnect unless manually closed
    if (!this.isManualClose) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      console.error('Max reconnect attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');

    const delay = Math.min(
      this.reconnectConfig.baseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.reconnectConfig.maxDelayMs
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error('Reconnect failed:', err);
      });
    }, delay);
  }

  /**
   * Send resync request to recover missed events
   */
  private resync(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.lastSeenSeq.size === 0) return;

    const msg: ClientToServer = {
      kind: 'resync',
      lastSeen: Object.fromEntries(this.lastSeenSeq),
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Update status and notify listeners
   */
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in status listener:', err);
      }
    }
  }
}

/**
 * Resolve WebSocket URL based on current location
 * In development, connect directly to backend server
 */
export function resolveWsUrl(): string {
  const configuredUrl = import.meta.env.VITE_BACKEND_WS_URL;
  if (configuredUrl) {
    return normalizeWsUrl(configuredUrl);
  }

  // In development mode, default to the local backend even when no browser
  // location object is available, such as in node-based tests.
  if (import.meta.env.DEV || typeof window === 'undefined') {
    return 'ws://127.0.0.1:4173/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}
