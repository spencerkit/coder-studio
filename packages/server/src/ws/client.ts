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

export type ClientId = string;
export type MessageHandler = (msg: ClientToServer) => void;
export type CloseHandler = () => void;

export class WsClient {
  readonly id: ClientId;
  private subscriptions = new Set<string>();
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
   * Send a message to the client
   * Returns false if send fails (backpressure or closed)
   */
  send(msg: ServerToClient): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      // Check buffer backpressure
      if (this.socket.bufferedAmount > 1024 * 1024) {
        // 1 MB threshold
        console.warn(`Client ${this.id} has high backpressure, dropping message`);
        return false;
      }

      const data = JSON.stringify(msg);
      this.socket.send(data);
      return true;
    } catch (error) {
      console.error(`Failed to send message to client ${this.id}:`, error);
      return false;
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
