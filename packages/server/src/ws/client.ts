/**
 * WebSocket Client
 *
 * Manages a single WebSocket connection:
 * - Send commands, events, results
 * - Subscription management
 * - Backpressure handling
 */

import type { ServerToClient, ClientToServer, Event } from '@coder-studio/core';
import type WebSocket from 'ws';
import { StreamBuffer, type Frame } from './stream-buffer.js';

const HIGH_WATER = 512 * 1024;
const LOW_WATER = 128 * 1024;
const FLUSH_INTERVAL_MS = 30;

export type ClientId = string;
export type MessageHandler = (msg: ClientToServer) => void;
export type CloseHandler = () => void;

export class WsClient {
  readonly id: ClientId;
  private subscriptions = new Set<string>();
  private readonly streamBuffer = new StreamBuffer();
  private flushTimer: NodeJS.Timeout | null = null;
  private messageHandler: MessageHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private isAlive = true;

  constructor(
    private readonly socket: WebSocket,
    id: ClientId
  ) {
    this.id = id;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientToServer;
        this.messageHandler?.(msg);
      } catch (error) {
        console.error(`Failed to parse message from client ${this.id}:`, error);
      }
    });

    this.socket.on('close', () => {
      this.isAlive = false;
      this.clearFlushTimer();
      this.streamBuffer.destroy();
      this.closeHandler?.();
    });

    this.socket.on('pong', () => {
      this.isAlive = true;
    });
  }

  /**
   * Register message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register close handler
   */
  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  /**
   * Control-class send: bypasses application-level backpressure.
   * Stream-class senders go through sendStream() instead.
   */
  sendControl(msg: ServerToClient): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch (error) {
      console.error(`Failed to send message to client ${this.id}:`, error);
      return false;
    }
  }

  /**
   * Backwards-compatible alias for sendControl.
   * Kept so existing call sites (hub.send, dispatch results, sendToClient) compile unchanged.
   */
  send(msg: ServerToClient): boolean {
    return this.sendControl(msg);
  }

  /**
   * Stream-class send: queued per-topic, drop-oldest on overflow.
   * Caller-side ordering is preserved within a topic; across topics the
   * flusher uses fair rotation. Frontend recovers via seq-gap + replay.
   */
  sendStream(topic: string, msg: ServerToClient): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    const data = JSON.stringify(msg);
    const frame: Frame = {
      data,
      size: Buffer.byteLength(data, 'utf8'),
    };

    const buffered = this.socket.bufferedAmount ?? 0;
    if (buffered < HIGH_WATER && this.streamBuffer.isEmpty()) {
      try {
        this.socket.send(data);
      } catch (error) {
        console.error(`Failed to send stream frame to client ${this.id}:`, error);
      }
      return;
    }

    this.streamBuffer.enqueue(topic, frame);
    this.flushStream();
  }

  /**
   * Sugar for stream-class events (mirrors sendEvent for control class).
   */
  sendEventStream(topic: string, data: unknown, seq: number = 0): void {
    const event: Event = {
      kind: 'event',
      topic,
      seq,
      timestamp: Date.now(),
      data,
    };
    this.sendStream(topic, event);
  }

  private flushStream(): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.clearFlushTimer();
      this.streamBuffer.destroy();
      return;
    }

    const buffered = this.socket.bufferedAmount ?? 0;
    if (buffered < LOW_WATER) {
      const headroom = HIGH_WATER - buffered;
      this.streamBuffer.drain(headroom, (data) => {
        try {
          this.socket.send(data);
          return true;
        } catch (error) {
          console.error(`Stream send failed for client ${this.id}:`, error);
          return false;
        }
      });
    }

    if (this.streamBuffer.isEmpty()) {
      this.clearFlushTimer();
    } else {
      this.ensureFlushTimer();
    }
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushStream(), FLUSH_INTERVAL_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Send an event message
   */
  sendEvent(topic: string, data: unknown, seq: number = 0): boolean {
    const event: Event = {
      kind: 'event',
      topic,
      seq,
      timestamp: Date.now(),
      data,
    };
    return this.send(event);
  }

  /**
   * Check if client subscribes to a topic (supports glob patterns)
   */
  subscribesTo(topic: string): boolean {
    for (const pattern of this.subscriptions) {
      if (this.matchTopic(pattern, topic)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add subscriptions
   */
  subscribe(topics: string[]): void {
    for (const topic of topics) {
      this.subscriptions.add(topic);
    }
  }

  /**
   * Remove subscriptions
   */
  unsubscribe(topics: string[]): void {
    for (const topic of topics) {
      this.subscriptions.delete(topic);
    }
  }

  /**
   * Check if connection is alive
   */
  get alive(): boolean {
    return this.isAlive && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Ping the client
   */
  ping(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.isAlive = false;
      this.socket.ping();
    }
  }

  /**
   * Close the connection
   */
  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  /**
   * Simple glob pattern matching for topics
   * Supports * as wildcard (e.g., "workspace.42.*" matches "workspace.42.session.1.state")
   */
  private matchTopic(pattern: string, topic: string): boolean {
    if (pattern === topic) return true;
    if (pattern === '*') return true;

    // Split pattern and topic into parts
    const patternParts = pattern.split('.');
    const topicParts = topic.split('.');

    // Match each part
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];

      // * matches any single part
      if (pp === '*') {
        // If this is the last part in pattern, match everything
        if (i === patternParts.length - 1) {
          return true;
        }
        continue;
      }

      // If pattern part doesn't match topic part
      if (i >= topicParts.length || pp !== topicParts[i]) {
        return false;
      }
    }

    // Pattern matched all parts
    return patternParts.length <= topicParts.length;
  }
}
