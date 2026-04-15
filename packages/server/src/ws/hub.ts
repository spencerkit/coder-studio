/**
 * WebSocket Hub
 *
 * Manages all WebSocket connections:
 * - Single writer enforcement (Phase 1)
 * - Connection handling and routing
 * - Event bus subscription and broadcasting
 * - Topic-based routing
 */

import type { DomainEvent, ServerToClient, ClientToServer, Command } from '@coder-studio/core';
import type WebSocket from 'ws';
import type { FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from '../bus/event-bus.js';
import { WsClient, ClientId } from './client.js';
import { dispatch, type CommandContext } from './dispatch.js';
import type { ServerConfig } from '../config.js';

interface WsHubDeps {
  eventBus: EventBus;
  commandContext: CommandContext;
  config: ServerConfig;
}

/**
 * Broadcaster interface for high-frequency streaming data
 * Used by TerminalManager to broadcast PTY output
 */
export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}

export class WsHub implements Broadcaster {
  private clients = new Map<ClientId, WsClient>();
  private writerId: ClientId | null = null;
  private eventUnsubscribers: (() => void)[] = [];

  constructor(private readonly deps: WsHubDeps) {
    this.subscribeToEvents();
  }

  /**
   * Handle a new WebSocket connection
   */
  handleConnection(socket: WebSocket, _req: FastifyRequest): void {
    const client = new WsClient(socket, uuidv4());

    // Phase 1: Single writer enforcement
    if (this.writerId && this.clients.has(this.writerId)) {
      const writer = this.clients.get(this.writerId);
      if (writer?.alive) {
        // Reject new connection
        client.sendEvent('connection.status', {
          status: 'rejected',
          reason: 'another_tab_active',
        });
        setTimeout(() => client.close(4001, 'another_tab_active'), 100);
        return;
      }
    }

    // Accept connection
    this.writerId = client.id;
    this.clients.set(client.id, client);

    // Send connection ready
    client.sendEvent('connection.status', {
      status: 'connected',
      clientId: client.id,
      authEnabled: this.deps.config.auth.enabled,
    });

    // Setup handlers
    client.onMessage((msg) => this.routeMessage(client, msg));
    client.onClose(() => this.handleClose(client));
  }

  /**
   * Route incoming message from client
   */
  private async routeMessage(client: WsClient, msg: ClientToServer): Promise<void> {
    switch (msg.kind) {
      case 'subscribe':
        client.subscribe(msg.topics);
        break;

      case 'unsubscribe':
        client.unsubscribe(msg.topics);
        break;

      case 'command':
        // Dispatch command and send result
        const result = await dispatch(msg as Command, this.deps.commandContext);
        client.send(result);
        break;

      case 'resync':
        // Handle resync request
        this.handleResync(client, msg.lastSeen);
        break;
    }
  }

  /**
   * Handle resync request
   */
  private handleResync(client: WsClient, lastSeen: Record<string, number>): void {
    // Phase 1: Basic implementation
    // For each topic in lastSeen, send missed events
    // This will be enhanced in Phase 2 with proper event replay
    client.sendEvent('connection.status', {
      status: 'resynced',
      topics: Object.keys(lastSeen),
    });
  }

  /**
   * Handle client close
   */
  private handleClose(client: WsClient): void {
    this.clients.delete(client.id);

    // Clear writer if this was the writer
    if (this.writerId === client.id) {
      this.writerId = null;
    }
  }

  /**
   * Takeover: Force close existing writer and accept new one
   * Used by tab.takeover command
   */
  async takeover(newClient: WsClient): Promise<void> {
    if (this.writerId) {
      const old = this.clients.get(this.writerId);
      if (old) {
        old.sendEvent('connection.status', { status: 'takeover' });
        old.close(4002, 'takeover');
        this.clients.delete(old.id);
      }
    }

    this.writerId = newClient.id;
    this.clients.set(newClient.id, newClient);
  }

  /**
   * Broadcast to all subscribed clients
   */
  broadcast(topic: string, payload: unknown): void {
    for (const client of this.clients.values()) {
      if (client.subscribesTo(topic)) {
        client.sendEvent(topic, payload);
      }
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: ClientId, msg: ServerToClient): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    return client.send(msg);
  }

  /**
   * Get the current writer client
   */
  getWriter(): WsClient | null {
    if (!this.writerId) return null;
    return this.clients.get(this.writerId) || null;
  }

  /**
   * Ping all clients for keepalive
   */
  pingAll(): void {
    for (const client of this.clients.values()) {
      client.ping();
    }
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
    this.writerId = null;
  }

  /**
   * Subscribe to domain events and broadcast them
   */
  private subscribeToEvents(): void {
    // Subscribe to all domain event types
    const eventTypes: DomainEvent['type'][] = [
      'session.state.changed',
      'session.lifecycle',
      'workspace.meta.changed',
      'git.state.changed',
      'fs.dirty',
    ];

    for (const type of eventTypes) {
      const unsub = this.deps.eventBus.on(type, (event) => {
        this.handleDomainEvent(event);
      });
      this.eventUnsubscribers.push(unsub);
    }
  }

  /**
   * Convert domain event to WebSocket event and broadcast
   */
  private handleDomainEvent(event: DomainEvent): void {
    let topic: string;
    let data: unknown;

    switch (event.type) {
      case 'session.state.changed':
        topic = `workspace.*.session.${event.sessionId}.state`;
        data = {
          state: event.to,
          from: event.from,
        };
        break;

      case 'session.lifecycle':
        topic = `workspace.*.session.${event.sessionId}.lifecycle`;
        data = {
          event: event.event,
        };
        break;

      case 'workspace.meta.changed':
        topic = `workspace.${event.workspaceId}.meta`;
        data = event.patch;
        break;

      case 'git.state.changed':
        topic = `workspace.${event.workspaceId}.git.state`;
        data = {}; // Actual git status will be fetched by client
        break;

      case 'fs.dirty':
        topic = `workspace.${event.workspaceId}.fs.dirty`;
        data = { reason: event.reason };
        break;

      default:
        return;
    }

    this.broadcast(topic, data);
  }

  /**
   * Cleanup event subscriptions
   */
  destroy(): void {
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];
    this.closeAll();
  }
}
