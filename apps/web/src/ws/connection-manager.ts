import { healthUrl, websocketUrl } from "../shared/runtime/backend";
import { isAuthenticated, isPublicModeActive } from "../services/http/auth.service";
import {
  getOrCreateClientId,
  getOrCreateDeviceId,
} from "../features/workspace/workspace-controller";
import { WsHeartbeat } from "./heartbeat";
import { parseWsEnvelope, type WsClientEnvelope, type WsEventEnvelope } from "./protocol";
import { getReconnectDelayMs } from "./reconnect-policy";

type EventHandler<T = unknown> = (payload: T) => void;
type AckResolver = { resolve: () => void; timer: number };
export type WsConnectionState = {
  kind: "connected" | "reconnected" | "disconnected";
  at: number;
  url: string;
};
type ConnectionHandler = (state: WsConnectionState) => void;

export class WsConnectionManager {
  private readonly listeners = new Map<string, Set<EventHandler<unknown>>>();
  private readonly connectionListeners = new Set<ConnectionHandler>();
  private readonly pendingAcks = new Map<string, AckResolver>();
  private lastConnectionState: WsConnectionState | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  private onlineListenerBound = false;
  private activeSocketUrl = "";
  private healthProbe: Promise<boolean> | null = null;
  private hasConnectedOnce = false;
  private readonly heartbeat = new WsHeartbeat({
    send: (message) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(message));
      }
    },
    onTimeout: () => {
      this.socket?.close();
    }
  });

  subscribe<T = unknown>(event: string, handler: EventHandler<T>) {
    const existing = this.listeners.get(event) ?? new Set<EventHandler<unknown>>();
    existing.add(handler as EventHandler<unknown>);
    this.listeners.set(event, existing);
    this.bindOnlineListeners();
    this.connect();

    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(handler as EventHandler<unknown>);
      if (current.size === 0) {
        this.listeners.delete(event);
      }
      this.prune();
    };
  }

  subscribeConnectionState(handler: ConnectionHandler) {
    this.connectionListeners.add(handler);
    this.bindOnlineListeners();
    if (this.lastConnectionState) {
      handler(this.lastConnectionState);
    }
    return () => {
      this.connectionListeners.delete(handler);
    };
  }

  send(message: WsClientEnvelope) {
    this.bindOnlineListeners();
    this.connect();
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.socket?.close();
      return false;
    }
  }

  /**
   * Send a message that requires server-side ACK confirmation.
   * Returns a Promise that resolves when the ACK is received,
   * or rejects after `timeoutMs` if no ACK arrives.
   */
  sendWithAck(message: WsClientEnvelope & { request_id?: string }, timeoutMs = 3000): Promise<boolean | null> {
    return new Promise((resolve) => {
      this.bindOnlineListeners();
      this.connect();
      if (this.socket?.readyState !== WebSocket.OPEN) {
        // Socket not open — message cannot be sent at all. Return null so the
        // caller knows to fall back to HTTP for guaranteed delivery.
        resolve(null);
        return;
      }
      const requestId = crypto.randomUUID();
      const enriched = { ...message, request_id: requestId };
      const timer = window.setTimeout(() => {
        this.pendingAcks.delete(requestId);
        // ACK timed out — the message WAS sent (socket was open), we just didn't
        // receive confirmation. Do NOT resolve(false) as an error; the caller
        // must not fall back to HTTP because the server likely processed it.
        resolve(false);
      }, timeoutMs);
      this.pendingAcks.set(requestId, { resolve: () => resolve(true), timer });
      try {
        this.socket!.send(JSON.stringify(enriched));
      } catch {
        window.clearTimeout(timer);
        this.pendingAcks.delete(requestId);
        resolve(false);
      }
    });
  }

  private bindOnlineListeners() {
    if (typeof window === "undefined" || this.onlineListenerBound) {
      return;
    }

    this.onlineListenerBound = true;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  private handleOnline = () => {
    this.isOnline = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  };

  private handleOffline = () => {
    this.isOnline = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  };

  private notify<T>(message: WsEventEnvelope) {
    const handlers = this.listeners.get(message.event);
    if (!handlers) return;
    handlers.forEach((handler) => handler(message.payload as T));
  }

  private notifyConnectionState(state: WsConnectionState) {
    this.lastConnectionState = state;
    this.connectionListeners.forEach((handler) => handler(state));
  }

  private scheduleReconnect() {
    if (!this.isOnline || this.reconnectTimer !== null || this.listeners.size === 0) return;
    const delay = getReconnectDelayMs(this.reconnectAttempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt += 1;
      this.connect();
    }, delay);
  }

  private connect() {
    if (typeof window === "undefined") return;
    if (!this.isOnline) return;
    if (isPublicModeActive() && !isAuthenticated()) {
      return;
    }
    let nextUrl = "";
    try {
      const baseUrl = new URL(websocketUrl());
      baseUrl.searchParams.set("device_id", getOrCreateDeviceId());
      baseUrl.searchParams.set("client_id", getOrCreateClientId());
      nextUrl = baseUrl.toString();
    } catch {
      this.scheduleReconnect();
      return;
    }
    // Treat CLOSING the same as CLOSED — if the socket is winding down,
    // don't wait for it; create a fresh connection.
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.activeSocketUrl === nextUrl) {
      return;
    }
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING && this.activeSocketUrl === nextUrl) {
      return;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.activeSocketUrl = nextUrl;
    void this.openSocket(nextUrl);
  }

  private async ensureBackendReady() {
    if (this.healthProbe) {
      return this.healthProbe;
    }

    this.healthProbe = fetch(healthUrl(), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        this.healthProbe = null;
      });

    return this.healthProbe;
  }

  private async openSocket(nextUrl: string) {
    const backendReady = await this.ensureBackendReady();
    if (!backendReady) {
      this.scheduleReconnect();
      return;
    }
    if (this.listeners.size === 0 || this.activeSocketUrl !== nextUrl) {
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.socket = new WebSocket(nextUrl);
    this.socket.addEventListener("open", () => {
      const kind = this.hasConnectedOnce ? "reconnected" : "connected";
      this.hasConnectedOnce = true;
      this.reconnectAttempt = 0;
      this.heartbeat.start();
      this.notifyConnectionState({ kind, at: Date.now(), url: nextUrl });
    });
    this.socket.addEventListener("message", (event) => {
      const envelope = parseWsEnvelope(String(event.data));
      if (!envelope) return;
      if (envelope.type === "event") {
        this.notify(envelope);
        return;
      }
      if (envelope.type === "pong") {
        this.heartbeat.markAlive();
        return;
      }
      if (envelope.type === "ack") {
        const resolver = this.pendingAcks.get(envelope.request_id);
        if (resolver) {
          window.clearTimeout(resolver.timer);
          resolver.resolve();
          this.pendingAcks.delete(envelope.request_id);
        }
        return;
      }
      if (envelope.type === "ping" && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "pong", ts: envelope.ts }));
      }
    });
    this.socket.addEventListener("close", () => {
      this.heartbeat.stop();
      // Reject all pending ACK promises on disconnect
      for (const [, resolver] of this.pendingAcks) {
        window.clearTimeout(resolver.timer);
        resolver.resolve();
      }
      this.pendingAcks.clear();
      this.socket = null;
      this.notifyConnectionState({ kind: "disconnected", at: Date.now(), url: nextUrl });
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  private prune() {
    if (this.listeners.size > 0) return;
    this.heartbeat.stop();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
