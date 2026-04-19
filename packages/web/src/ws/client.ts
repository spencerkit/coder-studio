/**
 * WebSocket Client
 *
 * Handles WebSocket connection, command sending, event subscription, and reconnection.
 * Independent of React/Jotai - uses callbacks for integration.
 */

import type { ServerToClient, ClientToServer } from '@coder-studio/core';
import { topicMatches } from './subscription';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'rejected';

export type EventListener = (topic: string, payload: unknown, seq: number) => void;
export type StatusListener = (status: ConnectionStatus) => void;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
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

export class WsClient {
  private ws: WebSocket | null = null;
  private pendingCommands = new Map<string, PendingCommand>();
  private eventListeners = new Map<string, Set<EventListener>>();
  private statusListeners = new Set<StatusListener>();
  private lastSeenSeq = new Map<string, number>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isManualClose = false;
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
    this.isManualClose = false;
    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.setStatus('connected');
          this.reconnectAttempts = 0;

          const subscribedTopics = Array.from(this.eventListeners.keys());
          if (subscribedTopics.length > 0) {
            const msg: ClientToServer = { kind: 'subscribe', topics: subscribedTopics };
            this.ws?.send(JSON.stringify(msg));
          }

          // Resync if we have lastSeen events
          if (this.lastSeenSeq.size > 0) {
            this.resync();
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as ServerToClient;
            this.handleMessage(msg);
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };

        this.ws.onclose = (event) => {
          this.handleClose(event.code, event.reason);
          reject(new Error(`WebSocket closed: ${event.reason || event.code}`));
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
        };
      } catch (err) {
        reject(err);
      }
    });
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

    if (this.ws) {
      this.ws.close(1000, reason || 'client_disconnect');
      this.ws = null;
    }

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('WebSocket disconnected'));
      this.pendingCommands.delete(id);
    }

    this.setStatus('disconnected');
  }

  /**
   * Send a command and wait for response
   */
  async sendCommand<T>(op: string, args: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = crypto.randomUUID();

      // Set timeout for command response
      const timeoutId = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command timeout: ${op}`));
      }, COMMAND_TIMEOUT_MS);

      // Store pending command
      this.pendingCommands.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      // Send command
      const msg: ClientToServer = { kind: 'command', id, op, args };
      this.ws.send(JSON.stringify(msg));
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
    if (!this.ws) return 'disconnected';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'disconnected';
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(msg: ServerToClient): void {
    if (msg.kind === 'result') {
      // Handle command result
      const pending = this.pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingCommands.delete(msg.id);

        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error?.message || 'Command failed'));
        }
      }
    } else if (msg.kind === 'event') {
      // Update last seen seq
      this.lastSeenSeq.set(msg.topic, msg.seq);

      // Dispatch to listeners
      for (const [pattern, listeners] of this.eventListeners.entries()) {
        if (!topicMatches(pattern, msg.topic)) {
          continue;
        }

        for (const listener of listeners) {
          try {
            listener(msg.topic, msg.data, msg.seq);
          } catch (err) {
            console.error(`Error in event listener for ${msg.topic}:`, err);
          }
        }
      }
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, _reason: string): void {
    this.ws = null;

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
  // In development mode, connect directly to backend
  if (import.meta.env.DEV) {
    console.log('[WS] Using development WebSocket URL: ws://127.0.0.1:4173/ws');
    return 'ws://127.0.0.1:4173/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws`;
  console.log('[WS] Using production WebSocket URL:', url);
  return url;
}
