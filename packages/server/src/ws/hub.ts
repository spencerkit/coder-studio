/**
 * WebSocket Hub
 *
 * Manages all WebSocket connections:
 * - Single writer enforcement (Phase 1)
 * - Connection handling and routing
 * - Event bus subscription and broadcasting
 * - Topic-based routing
 */

import type {
  ClientToServer,
  Command,
  DomainEvent,
  ServerToClient,
  TerminalInputBinaryArgs,
} from "@coder-studio/core";
import { encodeTerminalOutputFrame, Topics } from "@coder-studio/core";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { v4 as uuidv4 } from "uuid";
import type WebSocket from "ws";
import { EventBus } from "../bus/event-bus.js";
import { clearPendingTerminalInput, registerPendingTerminalInput } from "../commands/terminal.js";
import type { ServerConfig } from "../config.js";
import { ClientId, WsClient } from "./client.js";
import { type CommandContext, dispatch } from "./dispatch.js";
import type { FencingManager } from "./fencing.js";
import { isStreamTopic } from "./topic-class.js";

interface WsHubDeps {
  eventBus: EventBus;
  commandContext: CommandContext | null;
  config: ServerConfig;
  fencingMgr: FencingManager;
  logger?: FastifyBaseLogger;
}

const BINARY_PAYLOAD_TIMEOUT_MS = 5000;

interface BinaryWaiter {
  resolve: (payload: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const isBinaryTerminalInputArgs = (args: unknown): args is TerminalInputBinaryArgs => {
  return (
    typeof args === "object" &&
    args !== null &&
    "transport" in args &&
    (args as { transport?: unknown }).transport === "binary"
  );
};

/**
 * Broadcaster interface for fan-out of domain events to subscribed clients.
 * Used by FsWatcher and SupervisorManager; WsHub is the only implementation.
 * Internally routes via isStreamTopic so callers don't have to classify.
 */
export interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
  sendToClient(clientId: ClientId, msg: ServerToClient): boolean;
  sendBinaryToClient(clientId: ClientId, data: Buffer): boolean;
}

export class WsHub implements Broadcaster {
  private clients = new Map<ClientId, WsClient>();
  private eventUnsubscribers: (() => void)[] = [];
  private nextStreamId = 1;
  // Per-client queue of waiters for the next inbound binary frame. The
  // terminal.input protocol sends a JSON command immediately followed by a
  // binary payload — the JSON is dispatched synchronously, so we have to
  // await the binary frame here before letting the handler run.
  private pendingBinaryWaiters = new Map<ClientId, BinaryWaiter[]>();

  constructor(private readonly deps: WsHubDeps) {
    this.subscribeToEvents();
  }

  setLogger(logger: FastifyBaseLogger): void {
    this.deps.logger = logger;
  }

  setCommandContext(commandContext: CommandContext): void {
    this.deps.commandContext = commandContext;
  }

  /**
   * Handle a new WebSocket connection
   */
  handleConnection(socket: WebSocket, _req: FastifyRequest): void {
    const client = new WsClient(socket, uuidv4(), this.deps.logger);
    this.clients.set(client.id, client);

    // Send connection ready (controller status determined later by fencing.request command)
    client.sendEvent("connection.status", {
      status: "connected",
      clientId: client.id,
      authEnabled: this.deps.config.auth.enabled,
      binaryTerminalTransport: true,
    });

    // Setup handlers
    client.onMessage((msg) => this.routeMessage(client, msg));
    client.onClose(() => this.handleClose(client));
  }

  /**
   * Route incoming message from client
   */
  private async routeMessage(client: WsClient, msg: ClientToServer | Buffer): Promise<void> {
    if (Buffer.isBuffer(msg)) {
      this.deliverBinaryPayload(client.id, msg);
      return;
    }

    switch (msg.kind) {
      case "subscribe":
        client.subscribe(msg.topics);
        break;

      case "unsubscribe":
        client.unsubscribe(msg.topics);
        break;

      case "command": {
        const commandContext = this.getCommandContext();
        let pendingBinaryStreamId: number | null = null;
        if (msg.op === "terminal.input" && isBinaryTerminalInputArgs(msg.args)) {
          // The JSON command arrives one frame ahead of its binary payload.
          // Wait for the payload before dispatching so the handler can decode
          // synchronously by streamId.
          try {
            const payload = await this.awaitBinaryPayload(client.id);
            registerPendingTerminalInput(msg.args, payload);
            pendingBinaryStreamId = msg.args.streamId;
          } catch (error) {
            client.send({
              kind: "result",
              id: msg.id,
              ok: false,
              error: {
                code: "terminal_input_binary_timeout",
                message:
                  error instanceof Error
                    ? error.message
                    : "Timeout waiting for terminal input binary payload",
              },
            });
            break;
          }
        }
        const result = await dispatch(msg as Command, commandContext, client.id);
        if (
          pendingBinaryStreamId !== null &&
          !result.ok &&
          result.error?.code === "validation_error"
        ) {
          clearPendingTerminalInput(pendingBinaryStreamId);
        }
        client.send(result);
        break;
      }

      case "resync":
        this.handleResync(client, msg.lastSeen);
        break;
    }
  }

  private awaitBinaryPayload(clientId: ClientId): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.pendingBinaryWaiters.get(clientId);
        if (!waiters) return;
        const idx = waiters.findIndex((w) => w.timer === timer);
        if (idx === -1) return;
        waiters.splice(idx, 1);
        if (waiters.length === 0) {
          this.pendingBinaryWaiters.delete(clientId);
        }
        reject(new Error("Timeout waiting for terminal input binary payload"));
      }, BINARY_PAYLOAD_TIMEOUT_MS);

      const waiter: BinaryWaiter = { resolve, reject, timer };
      const queue = this.pendingBinaryWaiters.get(clientId);
      if (queue) {
        queue.push(waiter);
      } else {
        this.pendingBinaryWaiters.set(clientId, [waiter]);
      }
    });
  }

  private deliverBinaryPayload(clientId: ClientId, payload: Buffer): void {
    const queue = this.pendingBinaryWaiters.get(clientId);
    if (!queue || queue.length === 0) {
      return;
    }
    const waiter = queue.shift()!;
    if (queue.length === 0) {
      this.pendingBinaryWaiters.delete(clientId);
    }
    clearTimeout(waiter.timer);
    waiter.resolve(payload);
  }

  private discardPendingBinaryWaiters(clientId: ClientId): void {
    const queue = this.pendingBinaryWaiters.get(clientId);
    if (!queue) return;
    this.pendingBinaryWaiters.delete(clientId);
    for (const waiter of queue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Client disconnected before binary payload arrived"));
    }
  }

  /**
   * Handle resync request
   */
  private handleResync(client: WsClient, lastSeen: Record<string, number>): void {
    const commandContext = this.getCommandContext();
    const workspaces = commandContext.workspaceMgr.list();
    for (const workspace of workspaces) {
      const workspaceTopic = Topics.workspaceMeta(workspace.id);
      if (client.subscribesTo(workspaceTopic)) {
        client.sendEvent(workspaceTopic, workspace);
      }

      const sessions = commandContext.sessionMgr.getForWorkspace(workspace.id);
      for (const session of sessions) {
        const sessionTopic = Topics.sessionState(workspace.id, session.id);
        if (!client.subscribesTo(sessionTopic)) {
          continue;
        }
        client.sendEvent(sessionTopic, session);
      }
    }

    client.sendEvent("connection.status", {
      status: "resynced",
      topics: Object.keys(lastSeen),
    });
  }

  /**
   * Handle client close
   */
  private handleClose(client: WsClient): void {
    this.clients.delete(client.id);
    this.discardPendingBinaryWaiters(client.id);

    // Release fencing tokens held by this client
    // FencingManager tracks by clientId internally
    // Note: FencingManager doesn't have a method to release by clientId yet
    // This will be handled by the client calling fencing.release before disconnect
  }

  /**
   * Takeover: Force close existing writer and accept new one
   * DEPRECATED: This is now handled through fencing.takeover command
   * Kept for backward compatibility
   */
  async takeover(newClient: WsClient): Promise<void> {
    // Note: This method is deprecated in favor of FencingManager
    // Keeping for backward compatibility
    this.clients.set(newClient.id, newClient);
  }

  /**
   * Broadcast to all subscribed clients.
   * Routes by isStreamTopic: stream topics go through the per-topic queued
   * path; everything else goes through the control path (never dropped).
   */
  broadcast(topic: string, payload: unknown): void {
    const stream = isStreamTopic(topic);
    for (const client of this.clients.values()) {
      if (!client.subscribesTo(topic)) continue;
      if (stream && Buffer.isBuffer(payload)) {
        this.sendTerminalStreamToClient(client, topic, payload, 0);
      } else if (stream) {
        client.sendEventStream(topic, payload);
      } else {
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

  sendBinaryToClient(clientId: ClientId, data: Buffer): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    return client.sendBinary(data);
  }

  /**
   * Get the current writer client
   * DEPRECATED: Writer tracking now handled by FencingManager
   */
  getWriter(): WsClient | null {
    // Note: This method is deprecated in favor of FencingManager
    return null;
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
  }

  /**
   * Subscribe to domain events and broadcast them
   */
  private subscribeToEvents(): void {
    // Subscribe to all domain event types
    const eventTypes: DomainEvent["type"][] = [
      "session.state.changed",
      "session.lifecycle",
      "workspace.meta.changed",
      "git.state.changed",
      "fs.dirty",
      "terminal.created",
      "terminal.output",
      "terminal.exited",
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
    if (event.type === "terminal.output") {
      const topic = Topics.terminalOutput(event.workspaceId, event.terminalId);
      for (const client of this.clients.values()) {
        if (!client.subscribesTo(topic)) continue;
        this.sendTerminalStreamToClient(client, topic, event.chunk, event.seq);
      }
      return;
    }

    let topic: string;
    let data: unknown;

    switch (event.type) {
      case "session.state.changed":
        if (!event.workspaceId) {
          return;
        }
        topic = Topics.sessionState(event.workspaceId, event.sessionId);
        data = event.session ?? {
          state: event.to,
          from: event.from,
        };
        break;

      case "session.lifecycle":
        if (!event.workspaceId) {
          return;
        }
        topic = Topics.sessionLifecycle(event.workspaceId, event.sessionId);
        data = {
          event: event.event,
        };
        break;

      case "workspace.meta.changed":
        topic = Topics.workspaceMeta(event.workspaceId);
        data = event.patch;
        break;

      case "git.state.changed":
        topic = Topics.workspaceGitState(event.workspaceId);
        data = {
          treeChanged: Boolean(event.treeChanged),
          branchChanged: Boolean(event.branchChanged),
          worktreeChanged: Boolean(event.worktreeChanged),
        };
        break;

      case "fs.dirty":
        topic = Topics.workspaceFsDirty(event.workspaceId);
        data = { reason: event.reason };
        break;

      case "terminal.created":
        topic = Topics.terminalCreated(event.workspaceId, event.terminalId);
        data = {
          id: event.terminalId,
          kind: event.kind,
          title: event.title,
          cwd: event.cwd,
          workspaceId: event.workspaceId,
        };
        break;

      case "terminal.exited":
        topic = Topics.terminalExit(event.workspaceId, event.terminalId);
        data = {
          code: event.exitCode,
        };
        break;

      default:
        return;
    }

    this.broadcast(topic, data);
  }

  private sendTerminalStreamToClient(
    client: WsClient,
    topic: string,
    payload: Buffer,
    seq: number
  ): void {
    const streamId = this.allocateStreamId();
    client.sendStream(
      topic,
      Buffer.from(
        encodeTerminalOutputFrame({ topic, seq, streamId, payloadSize: payload.length }, payload)
      )
    );
  }

  private allocateStreamId(): number {
    const id = this.nextStreamId;
    this.nextStreamId += 1;
    return id;
  }

  private getCommandContext(): CommandContext {
    if (!this.deps.commandContext) {
      throw new Error("WebSocket command context has not been initialized");
    }
    return this.deps.commandContext;
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
