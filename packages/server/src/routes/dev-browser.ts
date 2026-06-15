import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type RawData, WebSocket as WsWebSocket } from "ws";
import { z } from "zod";
import {
  buildProxyWebSocketRequestOptions,
  filterProxyRequestHeaders,
  filterProxyResponseHeaders,
  rewriteProxyLocationHeader,
  rewriteProxyUrlReference,
} from "../dev-browser/proxy-headers.js";
import type { DevBrowserSession } from "../dev-browser/session-store.js";
import { DevBrowserSessionStore } from "../dev-browser/session-store.js";
import { DevBrowserTargetUrlError, parseDevBrowserTargetUrl } from "../dev-browser/target-url.js";

const createSessionSchema = z.object({
  url: z.string().min(1),
  userAgent: z.string().min(1).optional(),
});
const MAX_PENDING_WEBSOCKET_BYTES = 64 * 1024;
const preparedProxyWebSockets = new WeakMap<IncomingMessage, PreparedProxyWebSocket>();

interface PreparedProxyWebSocket {
  upstream: WsWebSocket;
  selectedProtocol: string;
  browserSocket: WsWebSocket | null;
  closeBrowser: ((code: number, reason: string) => void) | null;
  bufferedMessages: Array<{ data: RawData; isBinary: boolean }>;
  bufferedClose: { code: number; reason: Buffer } | null;
  bufferedError: boolean;
  upstreamClosed: boolean;
  upstreamReceivedMessage: boolean;
}

function browserProxyBase(id: string): string {
  return `/dev-browser/session/${id}/proxy`;
}

function browserUrl(id: string): string {
  return `/dev-browser/session/${id}/`;
}

function serializeSession(session: DevBrowserSession) {
  return {
    id: session.id,
    browserUrl: browserUrl(session.id),
    browserProxyBase: browserProxyBase(session.id),
    displayUrl: session.displayUrl,
    targetOrigin: session.targetOrigin,
    targetPath: session.targetPath,
    targetHash: session.targetHash,
    expiresAt: session.expiresAt,
    ...(session.preserveStudioPlatformPaths ? { preserveStudioPlatformPaths: true } : {}),
  };
}

function isCoderStudioHtml(html: string): boolean {
  return (
    html.includes("<title>Coder Studio</title>") ||
    html.includes('content="Coder Studio - Agent-First Development Environment"')
  );
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderDevBrowserShell(session: DevBrowserSession): string {
  const payload = serializeSession(session);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coder Studio Dev Browser</title>
</head>
<body>
  <p>Opening local preview...</p>
  <script>
    const session = ${escapeJsonForScript(payload)};
    function fallbackToProxyMode() {
      window.location.replace(session.browserProxyBase + session.targetPath + session.targetHash);
    }
    async function openDevBrowserSession() {
      if (!("serviceWorker" in navigator) || !window.isSecureContext) {
        fallbackToProxyMode();
        return;
      }
      const registration = await navigator.serviceWorker.register("/dev-browser-sw.js", { scope: "/dev-browser/" });
      await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting || registration.installing;
      worker?.postMessage({ type: "coder-studio-dev-browser-session", session });
      fallbackToProxyMode();
    }
    openDevBrowserSession().catch((error) => {
      console.error(error);
      fallbackToProxyMode();
    });
  </script>
</body>
</html>`;
}

function createHtmlBootstrap(session: DevBrowserSession): string {
  const payload = serializeSession(session);
  return `<script>
(function () {
  const session = ${escapeJsonForScript(payload)};
  const browserProxyBase = session.browserProxyBase;
  const targetOrigin = session.targetOrigin;
  const visiblePath = session.targetPath || "/";
  const targetPort = new URL(targetOrigin).port || "80";
  const currentPort =
    window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  const samePortAsStudio = currentPort === targetPort;
  const preserveStudioPlatformPaths = session.preserveStudioPlatformPaths === true;
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  function isCoderStudioPlatformPath(pathname) {
    return (
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/auth" ||
      pathname.startsWith("/auth/") ||
      pathname === "/healthz" ||
      pathname === "/internal" ||
      pathname.startsWith("/internal/") ||
      pathname === "/ws"
    );
  }
  function shouldProxyUrl(url) {
    if (!url) {
      return false;
    }
    if (url.host === window.location.host) {
      if (url.pathname.startsWith("/dev-browser/")) {
        return false;
      }
      if ((samePortAsStudio || preserveStudioPlatformPaths) && isCoderStudioPlatformPath(url.pathname)) {
        return false;
      }
      return true;
    }
    return url.protocol === "http:" && loopbackHosts.has(url.hostname) && (url.port || "80") === targetPort;
  }
  function shouldProxyWebSocketUrl(url) {
    if (!url) {
      return false;
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return false;
    }
    if (url.host === window.location.host) {
      if (url.pathname === "/ws") {
        return true;
      }
      return !url.pathname.startsWith("/dev-browser/");
    }
    const port = url.port || (url.protocol === "wss:" ? "443" : "80");
    return loopbackHosts.has(url.hostname) && port === targetPort;
  }
  function toProxyUrl(value, base) {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    let parsed;
    try {
      parsed = new URL(value, base || window.location.href);
    } catch {
      return null;
    }
    if (!shouldProxyUrl(parsed)) {
      return null;
    }
    return window.location.origin + browserProxyBase + parsed.pathname + parsed.search + parsed.hash;
  }
  function toProxyWebSocketUrl(value, base) {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    let parsed;
    try {
      parsed = new URL(value, base || window.location.href);
    } catch {
      return null;
    }
    if (!shouldProxyWebSocketUrl(parsed)) {
      return null;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host + browserProxyBase + parsed.pathname + parsed.search + parsed.hash;
  }
  function toPreservedStudioWebSocketUrl(value, base) {
    if (typeof value !== "string" || value.length === 0) {
      return null;
    }
    let parsed;
    try {
      parsed = new URL(value, base || window.location.href);
    } catch {
      return null;
    }
    if (!preserveStudioPlatformPaths || !loopbackHosts.has(parsed.hostname) || parsed.pathname !== "/ws") {
      return null;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host + "/ws";
  }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "coder-studio-dev-browser-session", session });
  }
  const navigatorUserAgent = ${escapeJsonForScript(session.userAgent ?? null)};
  if (navigatorUserAgent) {
    const navigatorOverrides = {
      userAgent: navigatorUserAgent,
      platform: /iPhone|iPad|iPod/.test(navigatorUserAgent)
        ? "iPhone"
        : /Android/.test(navigatorUserAgent)
          ? "Linux armv8l"
          : /Macintosh|Mac OS X/.test(navigatorUserAgent)
            ? "MacIntel"
            : /Windows/.test(navigatorUserAgent)
              ? "Win32"
              : navigator.platform,
      maxTouchPoints: /Mobile|Android|iPhone|iPad|iPod/.test(navigatorUserAgent)
        ? Math.max(navigator.maxTouchPoints || 0, 5)
        : navigator.maxTouchPoints,
    };
    for (const [key, value] of Object.entries(navigatorOverrides)) {
      try {
        Object.defineProperty(window.navigator, key, {
          configurable: true,
          value,
        });
      } catch {}
    }
  }
  const warningId = "coder-studio-dev-browser-websocket-warning";
  const warningText =
    "Coder Studio dev browser could not connect to a WebSocket. The preview may load, but live updates can fail.";
  let pendingWarningMessage = null;
  function mountWebSocketWarning() {
    if (!pendingWarningMessage || !document.body || document.getElementById(warningId)) {
      return;
    }
    const warning = document.createElement("div");
    warning.id = warningId;
    warning.setAttribute("role", "alert");
    warning.style.cssText =
      "position:sticky;top:0;z-index:2147483647;padding:10px 14px;border-bottom:1px solid rgba(245,158,11,0.45);background:#2b2111;color:#fbbf24;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    warning.textContent = pendingWarningMessage;
    document.body.prepend(warning);
  }
  function showWebSocketWarning(message) {
    pendingWarningMessage = message;
    if (document.body) {
      mountWebSocketWarning();
      return;
    }
    window.addEventListener("DOMContentLoaded", mountWebSocketWarning, { once: true });
  }
  const NativeWebSocket = window.WebSocket;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function coderStudioDevBrowserFetch(input, init) {
    const request = input instanceof Request ? input : null;
    const proxyUrl = toProxyUrl(request ? request.url : String(input), request ? undefined : window.location.href);
    if (!proxyUrl) {
      return nativeFetch(input, init);
    }
    if (request) {
      return nativeFetch(new Request(proxyUrl, request), init);
    }
    return nativeFetch(proxyUrl, init);
  };
  const NativeXMLHttpRequestOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function coderStudioDevBrowserOpen(method, url) {
    const proxyUrl = toProxyUrl(String(url), window.location.href);
    return NativeXMLHttpRequestOpen.call(
      this,
      method,
      proxyUrl ?? url,
      ...Array.prototype.slice.call(arguments, 2)
    );
  };
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = function CoderStudioDevBrowserEventSource(url, configuration) {
      const proxyUrl = toProxyUrl(String(url), window.location.href);
      return new NativeEventSource(proxyUrl ?? url, configuration);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(window.EventSource, NativeEventSource);
  }
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  try {
    nativeReplaceState(window.history.state, "", visiblePath + window.location.hash);
  } catch {}
  const nativeOpen = window.open.bind(window);
  window.open = function coderStudioDevBrowserOpenWindow(url, target, features) {
    const proxyUrl = typeof url === "string" ? toProxyUrl(url, window.location.href) : null;
    return nativeOpen(proxyUrl ?? url, target, features);
  };
  window.WebSocket = function CoderStudioDevBrowserWebSocket(url, protocols) {
    const value = String(url);
    const resolvedUrl = toPreservedStudioWebSocketUrl(value, window.location.href);
    const proxyUrl = resolvedUrl ?? toProxyWebSocketUrl(value, window.location.href);
    const socket = proxyUrl
      ? arguments.length > 1
        ? new NativeWebSocket(proxyUrl, protocols)
        : new NativeWebSocket(proxyUrl)
      : arguments.length > 1
        ? new NativeWebSocket(url, protocols)
        : new NativeWebSocket(url);
    if (proxyUrl || /^wss?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?\\b/.test(value)) {
      let opened = false;
      let warned = false;
      const warn = function () {
        if (warned) {
          return;
        }
        warned = true;
        console.warn("Coder Studio dev browser could not connect to a WebSocket.");
        showWebSocketWarning(warningText);
      };
      socket.addEventListener("open", function () {
        opened = true;
      }, { once: true });
      socket.addEventListener("error", function () {
        warn();
      }, { once: true });
      socket.addEventListener("close", function (event) {
        if (!opened || event.code !== 1000) {
          warn();
        }
      }, { once: true });
    }
    return socket;
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(window.WebSocket, NativeWebSocket);
})();
</script>`;
}

function rewriteHtmlAttributes(html: string, session: DevBrowserSession): string {
  const rewrite = (value: string) =>
    rewriteProxyUrlReference(value, {
      browserProxyBase: browserProxyBase(session.id),
      port: session.port,
      targetOrigin: session.targetOrigin,
    });

  return html.replace(
    /\b(?:src|href|action)=("([^"]*)"|'([^']*)')/gi,
    (match, quoted, doubleQuoted, singleQuoted) => {
      const quote = quoted[0];
      const value = doubleQuoted ?? singleQuoted ?? "";
      const nextValue = rewrite(value);
      return `${match.slice(0, match.indexOf(quoted))}${quote}${nextValue}${quote}`;
    }
  );
}

function rewriteJavaScriptModuleSpecifiers(source: string, session: DevBrowserSession): string {
  const rewrite = (value: string) =>
    rewriteProxyUrlReference(value, {
      browserProxyBase: browserProxyBase(session.id),
      port: session.port,
      targetOrigin: session.targetOrigin,
    });

  const rewriteSpecifier = (quote: string, value: string) => `${quote}${rewrite(value)}${quote}`;

  return source
    .replace(
      /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
      (_match, quote: string, value: string) => `import(${rewriteSpecifier(quote, value)})`
    )
    .replace(
      /\b(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?(['"])([^'"]+)\1/g,
      (match, quote: string, value: string) =>
        match.replace(`${quote}${value}${quote}`, rewriteSpecifier(quote, value))
    )
    .replace(
      /\bnew\s+URL\s*\(\s*(['"])([^'"]+)\1(\s*,\s*import\.meta\.url\s*\))/g,
      (_match, quote: string, value: string, suffix: string) =>
        `new URL(${rewriteSpecifier(quote, value)}${suffix}`
    );
}

function rewriteInlineModuleScripts(html: string, session: DevBrowserSession): string {
  return html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs: string, body: string) => {
      if (!/\btype\s*=\s*["']module["']/i.test(attrs) || /\bsrc\s*=/i.test(attrs)) {
        return match;
      }

      return `<script${attrs}>${rewriteJavaScriptModuleSpecifiers(body, session)}</script>`;
    }
  );
}

function injectHtmlBootstrap(html: string, session: DevBrowserSession): string {
  const bootstrap = createHtmlBootstrap(session);
  const rewrittenHtml = rewriteInlineModuleScripts(rewriteHtmlAttributes(html, session), session);
  const headMatch = rewrittenHtml.match(/<head\b[^>]*>/i);
  if (headMatch) {
    const insertAt = headMatch.index! + headMatch[0].length;
    return `${rewrittenHtml.slice(0, insertAt)}${bootstrap}${rewrittenHtml.slice(insertAt)}`;
  }

  const bodyMatch = rewrittenHtml.match(/<body\b[^>]*>/i);
  if (bodyMatch) {
    const insertAt = bodyMatch.index! + bodyMatch[0].length;
    return `${rewrittenHtml.slice(0, insertAt)}${bootstrap}${rewrittenHtml.slice(insertAt)}`;
  }

  return `${bootstrap}${rewrittenHtml}`;
}

function rewriteCssUrls(css: string, session: DevBrowserSession): string {
  return css.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (_match, quote: string, value: string) => {
      const nextValue = rewriteProxyUrlReference(value, {
        browserProxyBase: browserProxyBase(session.id),
        port: session.port,
        targetOrigin: session.targetOrigin,
      });
      return `url(${quote}${nextValue}${quote})`;
    }
  );
}

function bufferToBodyInit(buffer: Buffer): BodyInit {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

function resolveProxyTargetUrl(session: DevBrowserSession, request: FastifyRequest): URL {
  const incoming = new URL(request.url, "http://coder-studio.local");
  const prefix = `/dev-browser/session/${session.id}/proxy`;
  const path = incoming.pathname.startsWith(prefix)
    ? incoming.pathname.slice(prefix.length) || "/"
    : "/";
  const targetUrl = new URL(session.targetOrigin);
  targetUrl.pathname = path.startsWith("/") ? path : `/${path}`;
  targetUrl.search = incoming.search;
  return targetUrl;
}

function toWebSocketTargetUrl(targetUrl: URL): URL {
  const upstreamUrl = new URL(targetUrl);
  upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
  return upstreamUrl;
}

function getSessionFromRequest(
  sessions: DevBrowserSessionStore,
  request: FastifyRequest
): DevBrowserSession | null {
  const { id } = request.params as { id: string };
  return sessions.get(id) ?? null;
}

function isValidCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    (code >= 3000 && code <= 4999) ||
    (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)
  );
}

function rawDataByteLength(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  return data.byteLength;
}

function closeBrowserForUpstreamResult(
  closeBrowser: (code: number, reason: string) => void,
  result: { code: number; reason: Buffer },
  upstreamReceivedMessage: boolean
): void {
  if (!upstreamReceivedMessage && result.code === 1005 && result.reason.length === 0) {
    closeBrowser(1014, "dev_browser_target_unavailable");
    return;
  }

  closeBrowser(result.code, result.reason.toString());
}

async function prepareProxyWebSocket(
  request: FastifyRequest,
  session: DevBrowserSession
): Promise<PreparedProxyWebSocket | null> {
  const targetUrl = toWebSocketTargetUrl(resolveProxyTargetUrl(session, request));
  const { protocols, ...requestOptions } = buildProxyWebSocketRequestOptions(request.headers, {
    userAgent: session.userAgent,
  });
  if (!protocols || protocols.length === 0) {
    return null;
  }

  return await new Promise<PreparedProxyWebSocket>((resolve, reject) => {
    const upstream = new WsWebSocket(targetUrl, protocols, requestOptions);
    const prepared: PreparedProxyWebSocket = {
      upstream,
      selectedProtocol: "",
      browserSocket: null,
      closeBrowser: null,
      bufferedMessages: [],
      bufferedClose: null,
      bufferedError: false,
      upstreamClosed: false,
      upstreamReceivedMessage: false,
    };
    let upstreamOpened = false;
    let settled = false;

    const rejectUnavailable = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("dev_browser_target_unavailable"));
    };

    upstream.on("message", (data, isBinary) => {
      prepared.upstreamReceivedMessage = true;
      if (prepared.browserSocket?.readyState === WsWebSocket.OPEN) {
        prepared.browserSocket.send(data, { binary: isBinary });
        return;
      }
      prepared.bufferedMessages.push({ data, isBinary });
    });

    upstream.on("close", (code, reason) => {
      prepared.upstreamClosed = true;
      if (!upstreamOpened) {
        rejectUnavailable();
        return;
      }
      if (!prepared.closeBrowser) {
        prepared.bufferedClose = { code, reason };
        return;
      }
      closeBrowserForUpstreamResult(
        prepared.closeBrowser,
        { code, reason },
        prepared.upstreamReceivedMessage
      );
    });

    upstream.on("error", () => {
      if (!upstreamOpened) {
        rejectUnavailable();
        return;
      }
      if (!prepared.closeBrowser) {
        prepared.bufferedError = true;
        return;
      }
      if (!prepared.upstreamClosed) {
        prepared.closeBrowser(1011, "dev_browser_websocket_error");
      }
    });

    upstream.once("open", () => {
      upstreamOpened = true;
      if (settled) {
        return;
      }
      settled = true;
      prepared.selectedProtocol = upstream.protocol;
      resolve(prepared);
    });
  });
}

function bindPreparedProxyWebSocket(
  prepared: PreparedProxyWebSocket,
  browserSocket: WsWebSocket,
  closeBrowser: (code: number, reason: string) => void,
  closeUpstream: () => void
): void {
  prepared.browserSocket = browserSocket;
  prepared.closeBrowser = closeBrowser;

  for (const message of prepared.bufferedMessages.splice(0)) {
    if (browserSocket.readyState !== WsWebSocket.OPEN) {
      break;
    }
    browserSocket.send(message.data, { binary: message.isBinary });
  }

  if (prepared.bufferedClose) {
    closeBrowserForUpstreamResult(
      closeBrowser,
      prepared.bufferedClose,
      prepared.upstreamReceivedMessage
    );
    return;
  }

  if (prepared.bufferedError && !prepared.upstreamClosed) {
    closeBrowser(1011, "dev_browser_websocket_error");
    closeUpstream();
  }
}

async function proxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  session: DevBrowserSession
) {
  const targetUrl = resolveProxyTargetUrl(session, request);
  const targetHeaders = filterProxyRequestHeaders(request.headers, targetUrl.host, {
    userAgent: session.userAgent,
  });
  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: targetHeaders,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD" && request.body !== undefined) {
    if (Buffer.isBuffer(request.body)) {
      init.body = bufferToBodyInit(request.body);
    } else if (typeof request.body === "string") {
      init.body = request.body;
    } else {
      init.body = JSON.stringify(request.body);
      targetHeaders.set("content-type", "application/json");
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch {
    return reply.status(502).send({ error: "dev_browser_target_unavailable" });
  }

  const responseHeaders = filterProxyResponseHeaders(upstream.headers);
  const location = upstream.headers.get("location");
  if (location) {
    responseHeaders.set(
      "location",
      rewriteProxyLocationHeader(location, {
        browserProxyBase: browserProxyBase(session.id),
        port: session.port,
        targetOrigin: session.targetOrigin,
      })
    );
  }

  responseHeaders.forEach((value, key) => reply.header(key, value));
  reply.status(upstream.status);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const html = await upstream.text();
    const effectiveSession =
      isCoderStudioHtml(html) && !session.preserveStudioPlatformPaths
        ? { ...session, preserveStudioPlatformPaths: true }
        : session;
    return reply.type("text/html; charset=utf-8").send(injectHtmlBootstrap(html, effectiveSession));
  }

  if (contentType.includes("text/css")) {
    const css = rewriteCssUrls(await upstream.text(), session);
    return reply.type("text/css; charset=utf-8").send(css);
  }

  if (contentType.includes("javascript")) {
    const script = rewriteJavaScriptModuleSpecifiers(await upstream.text(), session);
    return reply.type("application/javascript; charset=utf-8").send(script);
  }

  return reply.send(Buffer.from(await upstream.arrayBuffer()));
}

function proxyWebSocket(
  request: FastifyRequest,
  browserSocket: WsWebSocket,
  session: DevBrowserSession,
  prepared: PreparedProxyWebSocket | null = null
) {
  const targetUrl = prepared ? null : toWebSocketTargetUrl(resolveProxyTargetUrl(session, request));
  const { protocols, ...requestOptions } = prepared
    ? { headers: {} }
    : buildProxyWebSocketRequestOptions(request.headers, { userAgent: session.userAgent });
  const upstream = prepared
    ? prepared.upstream
    : new WsWebSocket(targetUrl!, protocols, requestOptions);

  let upstreamOpened = prepared !== null;
  let browserClosed = false;
  let upstreamClosed = prepared?.upstreamClosed ?? false;
  let upstreamReceivedMessage = prepared?.upstreamReceivedMessage ?? false;
  let pendingBytes = 0;
  const pendingMessages: Array<{ data: RawData; isBinary: boolean }> = [];

  const closeBrowser = (code: number, reason: string) => {
    if (browserClosed) {
      return;
    }
    browserClosed = true;
    if (isValidCloseCode(code)) {
      browserSocket.close(code, reason);
      return;
    }
    browserSocket.close();
  };

  const closeUpstream = (code?: number, reason?: Buffer) => {
    if (prepared ? prepared.upstreamClosed : upstreamClosed) {
      return;
    }
    if (prepared) {
      prepared.upstreamClosed = true;
    } else {
      upstreamClosed = true;
    }
    if (code === undefined || !isValidCloseCode(code)) {
      upstream.close();
      return;
    }
    upstream.close(code, reason?.toString());
  };

  browserSocket.on("message", (data, isBinary) => {
    if (upstream.readyState === WsWebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    if (upstream.readyState === WsWebSocket.CONNECTING) {
      pendingBytes += rawDataByteLength(data);
      if (pendingBytes > MAX_PENDING_WEBSOCKET_BYTES) {
        pendingMessages.length = 0;
        closeBrowser(1009, "dev_browser_websocket_buffer_overflow");
        closeUpstream();
        return;
      }
      pendingMessages.push({ data, isBinary });
    }
  });

  browserSocket.on("close", (code, reason) => {
    closeUpstream(code, reason);
  });

  browserSocket.on("error", () => {
    closeUpstream();
  });

  if (prepared) {
    bindPreparedProxyWebSocket(prepared, browserSocket, closeBrowser, () => closeUpstream());
    return;
  }

  upstream.on("open", () => {
    upstreamOpened = true;
    for (const message of pendingMessages.splice(0)) {
      upstream.send(message.data, { binary: message.isBinary });
    }
    pendingBytes = 0;
  });

  upstream.on("message", (data, isBinary) => {
    upstreamReceivedMessage = true;
    if (browserSocket.readyState === WsWebSocket.OPEN) {
      browserSocket.send(data, { binary: isBinary });
    }
  });

  upstream.on("close", (code, reason) => {
    upstreamClosed = true;
    if (!upstreamOpened) {
      closeBrowser(1014, "dev_browser_target_unavailable");
      return;
    }
    closeBrowserForUpstreamResult(closeBrowser, { code, reason }, upstreamReceivedMessage);
  });

  upstream.on("error", () => {
    if (!upstreamOpened) {
      closeBrowser(1014, "dev_browser_target_unavailable");
      return;
    }
    closeBrowser(1011, "dev_browser_websocket_error");
  });
}

export function registerDevBrowserRoutes(
  app: FastifyInstance,
  deps: { sessions?: DevBrowserSessionStore } = {}
): void {
  const sessions = deps.sessions ?? new DevBrowserSessionStore();
  const existingHandleProtocols = app.websocketServer.options.handleProtocols;
  app.websocketServer.options.handleProtocols = (protocols, rawRequest) => {
    const prepared = preparedProxyWebSockets.get(rawRequest);
    if (prepared) {
      return prepared.selectedProtocol;
    }
    return existingHandleProtocols
      ? existingHandleProtocols(protocols, rawRequest)
      : (protocols.values().next().value ?? false);
  };

  app.post("/api/dev-proxy/session", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_dev_browser_payload" });
    }

    try {
      const session = sessions.create({
        ...parseDevBrowserTargetUrl(parsed.data.url),
        ...(parsed.data.userAgent ? { userAgent: parsed.data.userAgent } : {}),
      });
      return reply.send(serializeSession(session));
    } catch (error) {
      if (error instanceof DevBrowserTargetUrlError) {
        return reply.status(400).send({ error: "invalid_dev_browser_target" });
      }
      throw error;
    }
  });

  app.get("/api/dev-proxy/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    return session
      ? reply.send(serializeSession(session))
      : reply.status(404).send({ error: "dev_browser_session_not_found" });
  });

  app.delete("/api/dev-proxy/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    sessions.delete(id);
    return reply.send({ ok: true });
  });

  app.get("/dev-browser/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.redirect(`/dev-browser/session/${id}/`);
  });

  app.get("/dev-browser/session/:id/", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: "dev_browser_session_not_found" });
    }
    return reply.type("text/html; charset=utf-8").send(renderDevBrowserShell(session));
  });

  app.register(async (proxyApp) => {
    proxyApp.removeAllContentTypeParsers();
    proxyApp.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    proxyApp.route({
      method: "GET",
      url: "/dev-browser/session/:id/proxy/*",
      preHandler: async (request, reply) => {
        preparedProxyWebSockets.delete(request.raw);

        const session = getSessionFromRequest(sessions, request);
        if (!session) {
          return reply.status(404).send({ error: "dev_browser_session_not_found" });
        }

        if (request.ws) {
          try {
            const prepared = await prepareProxyWebSocket(request, session);
            if (prepared) {
              preparedProxyWebSockets.set(request.raw, prepared);
            }
          } catch {
            return reply.status(502).send({
              error: "dev_browser_target_unavailable",
            });
          }
        }
      },
      handler: async (request, reply) => {
        const session = getSessionFromRequest(sessions, request);
        if (!session) {
          return reply.status(404).send({ error: "dev_browser_session_not_found" });
        }
        return proxyRequest(request, reply, session);
      },
      wsHandler: (socket, request) => {
        const session = getSessionFromRequest(sessions, request);
        if (!session) {
          socket.close(1008, "dev_browser_session_not_found");
          return;
        }
        const prepared = preparedProxyWebSockets.get(request.raw) ?? null;
        preparedProxyWebSockets.delete(request.raw);
        proxyWebSocket(request, socket, session, prepared);
      },
    });

    proxyApp.route({
      method: ["DELETE", "OPTIONS", "PATCH", "POST", "PUT"],
      url: "/dev-browser/session/:id/proxy/*",
      handler: async (request, reply) => {
        const session = getSessionFromRequest(sessions, request);
        if (!session) {
          return reply.status(404).send({ error: "dev_browser_session_not_found" });
        }
        return proxyRequest(request, reply, session);
      },
    });
  });
}
