type EventHandler<T> = (event: { payload: T }) => void;
type Unlisten = () => void;

declare global {
  interface Window {
    __CODER_STUDIO_BACKEND__?: string;
  }
}

type WsEnvelope = {
  event: string;
  payload: unknown;
};

const listeners = new Map<string, Set<EventHandler<unknown>>>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let activeSocketUrl = "";

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = typeof window !== "undefined"
      ? new URL(trimmed, window.location.origin)
      : new URL(trimmed);
    return parsed.origin.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
};

const readInjectedBackendBase = () => {
  if (typeof window === "undefined") return "";
  return normalizeBaseUrl(window.__CODER_STUDIO_BACKEND__ ?? "");
};

const collectBackendBaseCandidates = () => {
  if (typeof window === "undefined") return [""];
  const explicit = readInjectedBackendBase();
  if (explicit) {
    return [explicit];
  }
  return [normalizeBaseUrl(window.location.origin)];
};

const backendBaseUrl = () => {
  return collectBackendBaseCandidates()[0] ?? "";
};

const websocketUrl = () => {
  const baseValue = backendBaseUrl();
  const base = new URL(baseValue || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1"));
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  return base.toString();
};

const notify = (message: WsEnvelope) => {
  const handlers = listeners.get(message.event);
  if (!handlers) return;
  handlers.forEach((handler) => handler({ payload: message.payload }));
};

const scheduleReconnect = () => {
  if (reconnectTimer !== null || listeners.size === 0) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, 800);
};

const connectSocket = () => {
  if (typeof window === "undefined") return;
  let nextUrl = "";
  try {
    nextUrl = websocketUrl();
  } catch {
    scheduleReconnect();
    return;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) && activeSocketUrl === nextUrl) {
    return;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  activeSocketUrl = nextUrl;
  socket = new WebSocket(nextUrl);
  socket.addEventListener("message", (event) => {
    try {
      notify(JSON.parse(String(event.data)) as WsEnvelope);
    } catch {
      // Ignore malformed frames.
    }
  });
  socket.addEventListener("close", () => {
    socket = null;
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    socket?.close();
  });
};

const pruneSocket = () => {
  if (listeners.size > 0) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
};

export const invoke = async <T = unknown>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const candidates = collectBackendBaseCandidates();
  const errors: string[] = [];

  for (const base of candidates) {
    try {
      const endpoint = new URL(`/api/rpc/${command}`, `${base}/`).toString();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      let body: { ok?: boolean; data?: T; error?: string } = {};
      try {
        body = await response.json();
      } catch {
        // Leave empty and fail below.
      }

      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      return body.data as T;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${base || "unknown_base"}: ${reason}`);
    }
  }

  // Fallback path for desktop runtime when HTTP bridge is temporarily unavailable.
  if (typeof window !== "undefined" && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const tauriCore = await import("@tauri-apps/api/core");
      return await tauriCore.invoke<T>(command, payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`tauri_invoke: ${reason}`);
    }
  }

  throw new Error(errors.join(" | "));
};

export const listen = async <T = unknown>(event: string, handler: EventHandler<T>): Promise<Unlisten> => {
  const existing = listeners.get(event) ?? new Set<EventHandler<unknown>>();
  existing.add(handler as EventHandler<unknown>);
  listeners.set(event, existing);
  connectSocket();

  return () => {
    const current = listeners.get(event);
    if (!current) return;
    current.delete(handler as EventHandler<unknown>);
    if (current.size === 0) {
      listeners.delete(event);
    }
    pruneSocket();
  };
};
