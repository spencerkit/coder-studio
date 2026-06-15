import type { IncomingHttpHeaders } from "node:http";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const BLOCKED_REQUEST_HEADERS = new Set(["cookie", "authorization", "origin"]);
const BLOCKED_RESPONSE_HEADERS = new Set(["content-length", "content-encoding", "set-cookie"]);
const BLOCKED_WEBSOCKET_REQUEST_HEADERS = new Set([
  ...BLOCKED_REQUEST_HEADERS,
  "connection",
  "upgrade",
  "host",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(", ") : value;
}

function appendHeader(target: Headers, key: string, value: string | string[] | undefined): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      target.append(key, entry);
    }
    return;
  }

  target.set(key, value);
}

export function filterProxyRequestHeaders(
  headers: IncomingHttpHeaders,
  targetHost: string,
  options: { userAgent?: string } = {}
): Headers {
  const filtered = new Headers();

  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || BLOCKED_REQUEST_HEADERS.has(key) || key === "host") {
      continue;
    }

    appendHeader(filtered, key, value);
  }

  filtered.set("host", targetHost);
  if (options.userAgent) {
    filtered.set("user-agent", options.userAgent);
  }
  return filtered;
}

export function buildProxyWebSocketRequestOptions(headers: IncomingHttpHeaders): {
  headers: Record<string, string>;
  protocols?: string[];
};
export function buildProxyWebSocketRequestOptions(
  headers: IncomingHttpHeaders,
  options: { userAgent?: string }
): {
  headers: Record<string, string>;
  protocols?: string[];
};
export function buildProxyWebSocketRequestOptions(
  headers: IncomingHttpHeaders,
  options: { userAgent?: string } = {}
): {
  headers: Record<string, string>;
  protocols?: string[];
} {
  const filteredHeaders: Record<string, string> = {};
  let protocols: string[] | undefined;

  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();

    if (key === "sec-websocket-protocol") {
      const normalized = normalizeHeaderValue(value);
      if (normalized) {
        const parsedProtocols = normalized
          .split(",")
          .map((protocol) => protocol.trim())
          .filter(Boolean);

        if (parsedProtocols.length > 0) {
          protocols = parsedProtocols;
        }
      }
      continue;
    }

    if (BLOCKED_WEBSOCKET_REQUEST_HEADERS.has(key)) {
      continue;
    }

    const normalized = normalizeHeaderValue(value);
    if (normalized !== undefined) {
      filteredHeaders[key] = normalized;
    }
  }

  if (options.userAgent) {
    filteredHeaders["user-agent"] = options.userAgent;
  }

  return protocols ? { headers: filteredHeaders, protocols } : { headers: filteredHeaders };
}

export function filterProxyResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers();

  headers.forEach((value, rawKey) => {
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key) || BLOCKED_RESPONSE_HEADERS.has(key)) {
      return;
    }

    filtered.set(key, value);
  });

  return filtered;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function effectivePort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === "http:" ? 80 : 443;
}

function toProxiedLoopbackUrl(
  parsed: URL,
  input: { browserProxyBase: string; port: number; targetOrigin: string }
): string | null {
  const isLoopback =
    parsed.protocol === "http:" &&
    effectivePort(parsed) === input.port &&
    isLoopbackHostname(parsed.hostname);

  if (!isLoopback) {
    return null;
  }

  return `${input.browserProxyBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function rewriteProxyUrlReference(
  value: string,
  input: { browserProxyBase: string; port: number; targetOrigin: string }
): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return value;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return `${input.browserProxyBase}${trimmed}`;
  }

  if (!/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/)/.test(trimmed)) {
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, input.targetOrigin);
  } catch {
    return value;
  }

  return toProxiedLoopbackUrl(parsed, input) ?? value;
}

export function rewriteProxyLocationHeader(
  location: string,
  input: { browserProxyBase: string; port: number; targetOrigin: string }
): string {
  if (location.startsWith("/") && !location.startsWith("//")) {
    return `${input.browserProxyBase}${location}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(location, input.targetOrigin);
  } catch {
    return location;
  }

  return toProxiedLoopbackUrl(parsed, input) ?? location;
}
