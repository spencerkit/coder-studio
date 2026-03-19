import { healthUrl, websocketUrl } from "../shared/runtime/backend";
import { isAuthenticated, isPublicModeActive } from "../services/http/auth.service";
import { WsHeartbeat } from "./heartbeat";
import { parseWsEnvelope, type WsEventEnvelope } from "./protocol";

type EventHandler<T = unknown> = (payload: T) => void;

export class WsConnectionManager {
  private readonly listeners = new Map<string, Set<EventHandler<unknown>>>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private activeSocketUrl = "";
  private healthProbe: Promise<boolean> | null = null;
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

  private notify<T>(message: WsEventEnvelope) {
    const handlers = this.listeners.get(message.event);
    if (!handlers) return;
    handlers.forEach((handler) => handler(message.payload as T));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.listeners.size === 0) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 800);
  }

  private connect() {
    if (typeof window === "undefined") return;
    if (isPublicModeActive() && !isAuthenticated()) {
      return;
    }
    let nextUrl = "";
    try {
      nextUrl = websocketUrl();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) && this.activeSocketUrl === nextUrl) {
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
      this.heartbeat.start();
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
      if (envelope.type === "ping" && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "pong", ts: envelope.ts }));
      }
    });
    this.socket.addEventListener("close", () => {
      this.heartbeat.stop();
      this.socket = null;
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
