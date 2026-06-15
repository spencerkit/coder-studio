import {
  type AddressInfo,
  createServer as createNetServer,
  type Socket as NetSocket,
} from "node:net";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket as ClientWebSocket, type RawData, type WebSocket as WsWebSocket } from "ws";
import { DevBrowserSessionStore } from "../dev-browser/session-store.js";
import { registerDevBrowserRoutes } from "./dev-browser.js";

function waitForMessage(socket: WsWebSocket): Promise<{ data: RawData; isBinary: boolean }> {
  return new Promise((resolve, reject) => {
    const handleMessage = (data: RawData, isBinary: boolean) => {
      cleanup();
      resolve({ data, isBinary });
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`socket closed before message: ${code} ${reason.toString()}`));
    };
    const cleanup = () => {
      socket.off("message", handleMessage);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    };

    socket.on("message", handleMessage);
    socket.on("error", handleError);
    socket.on("close", handleClose);
  });
}

function waitForClose(socket: WsWebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      resolve({ code, reason: reason.toString() });
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("close", handleClose);
      socket.off("error", handleError);
    };

    socket.on("close", handleClose);
    socket.on("error", handleError);
  });
}

async function waitForExpectation(
  check: () => void,
  timeoutMs = 1000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  check();
}

describe("dev browser routes", () => {
  let target: ReturnType<typeof Fastify>;
  let app: ReturnType<typeof Fastify>;
  let targetOrigin: string;
  let targetPort: number;
  let observedUpstreamClose: { code: number; reason: string } | null;
  let observedHttpUserAgent: string | undefined;
  let observedWsUserAgent: string | undefined;

  beforeEach(async () => {
    observedUpstreamClose = null;
    observedHttpUserAgent = undefined;
    observedWsUserAgent = undefined;
    target = Fastify({ logger: false });
    await target.register(websocket, {
      options: {
        handleProtocols: (protocols, request) => {
          if (request.url?.startsWith("/ws-protocol")) {
            return protocols.has("superjson") ? "superjson" : protocols.values().next().value;
          }
          return protocols.values().next().value;
        },
      },
    });
    target.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "buffer" },
      (_request, body, done) => {
        done(null, body);
      }
    );
    target.get("/app/", async (_request, reply) =>
      reply
        .type("text/html")
        .send(
          '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><img src="/images/logo.png"><a href="/docs">docs</a><form action="/submit" method="post"></form><script src="/assets/app.js"></script></body></html>'
        )
    );
    target.get("/vite/", async (_request, reply) =>
      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);</script>
    <script type="module" src="/@vite/client"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`)
    );
    target.get("/studio/", async (_request, reply) =>
      reply.type("text/html").send(`<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Coder Studio - Agent-First Development Environment" />
    <title>Coder Studio</title>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`)
    );
    target.get("/assets/app.css", async (_request, reply) =>
      reply
        .type("text/css")
        .send(
          `body{background-image:url("/images/bg.png")} .logo{background-image:url("http://localhost:${targetPort}/images/abs.png")} .icon{background-image:url(./icon.svg)}`
        )
    );
    target.get("/@vite/client", async (_request, reply) =>
      reply
        .type("application/javascript")
        .send('import "/src/vite-setup.ts"; export const base = "/";')
    );
    target.get("/assets/app.js", async (_request, reply) =>
      reply.type("application/javascript").send("window.loaded = true;")
    );
    target.get("/observe-user-agent", async (request) => {
      observedHttpUserAgent = request.headers["user-agent"];
      return { userAgent: observedHttpUserAgent ?? null };
    });
    target.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (message, isBinary) => {
        socket.send(message, { binary: isBinary });
      });
    });
    target.get("/ws-observe-user-agent", { websocket: true }, (socket, request) => {
      observedWsUserAgent = request.headers["user-agent"];
      socket.send(`user-agent:${observedWsUserAgent ?? ""}`);
    });
    target.get("/ws-protocol", { websocket: true }, (socket) => {
      socket.send(`protocol:${socket.protocol}`);
      socket.on("message", (message, isBinary) => {
        socket.send(message, { binary: isBinary });
      });
    });
    target.get("/ws-close", { websocket: true }, (socket) => {
      socket.close(4001, "upstream_done");
    });
    target.get("/ws-observe-close", { websocket: true }, (socket) => {
      socket.send("ready");
      socket.on("close", (code, reason) => {
        observedUpstreamClose = {
          code,
          reason: reason.toString(),
        };
      });
    });
    target.get("/src/main.tsx", async (_request, reply) =>
      reply
        .type("application/javascript")
        .send(`import React from "/node_modules/.vite/deps/react.js?v=1";
import App from "/src/App.tsx";
const lazy = () => import("/src/lazy.tsx");
console.log(React, App, lazy);`)
    );
    target.post("/api/echo", async (request) => request.body);
    target.post("/api/form", async (request) => ({
      body: Buffer.isBuffer(request.body)
        ? request.body.toString("utf-8")
        : String(request.body ?? ""),
      contentType: request.headers["content-type"],
    }));
    target.get("/redirect", async (_request, reply) => reply.redirect("/app/"));
    target.get("/*", async (request) => ({ url: request.url }));
    await target.listen({ host: "127.0.0.1", port: 0 });

    const address = target.server.address();
    if (!address || typeof address === "string") {
      throw new Error("target listen failed");
    }
    targetPort = address.port;
    targetOrigin = `http://127.0.0.1:${address.port}`;

    app = Fastify({ logger: false });
    await app.register(websocket);
    registerDevBrowserRoutes(app, {
      sessions: new DevBrowserSessionStore(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await target.close();
  });

  async function createSession(
    path = "/app/",
    options: {
      userAgent?: string;
    } = {}
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev-proxy/session",
      payload: { url: `${targetOrigin}${path}`, ...options },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      browserProxyBase: string;
      browserUrl: string;
      id: string;
      targetOrigin: string;
    };
  }

  it("creates sessions for loopback targets", async () => {
    const created = await createSession();

    expect(created.id).toMatch(/^dev_/);
    expect(created.browserUrl).toBe(`/dev-browser/session/${created.id}/`);
    expect(created.browserProxyBase).toBe(`/dev-browser/session/${created.id}/proxy`);
    expect(created.targetOrigin).toBe(targetOrigin);
  });

  it("rejects invalid session targets", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev-proxy/session",
      payload: { url: "http://example.com:8000" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_dev_browser_target" });
  });

  it("serves shell HTML that registers the service worker", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: created.browserUrl,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("/dev-browser-sw.js");
    expect(response.body).toContain(created.browserProxyBase);
    expect(response.body).toContain(
      "window.location.replace(session.browserProxyBase + session.targetPath + session.targetHash)"
    );
    expect(response.body).toContain(
      "window.location.replace(session.browserProxyBase + session.targetPath + session.targetHash)"
    );
  });

  it("proxies HTML and injects a websocket failure warning bootstrap without blocking page load", async () => {
    const userAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
    const created = await createSession("/app/", { userAgent });
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/app/`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Coder Studio dev browser could not connect to a WebSocket");
    expect(response.body).toContain("coder-studio-dev-browser-websocket-warning");
    expect(response.body).toContain("function toProxyWebSocketUrl(value, base)");
    expect(response.body).toContain(
      "const proxyUrl = resolvedUrl ?? toProxyWebSocketUrl(value, window.location.href);"
    );
    expect(response.body).toContain("function isCoderStudioPlatformPath(pathname) {");
    expect(response.body).toContain('pathname === "/healthz"');
    expect(response.body).toContain('pathname === "/ws"');
    expect(response.body).toContain('pathname.startsWith("/auth/")');
    expect(response.body).toContain('pathname.startsWith("/api/")');
    expect(response.body).toContain("const currentPort =");
    expect(response.body).toContain("const samePortAsStudio = currentPort === targetPort;");
    const httpProxyStart = response.body.indexOf("function shouldProxyUrl(url) {");
    const httpProxyEnd = response.body.indexOf("function shouldProxyWebSocketUrl(url) {");
    const httpProxyBody = response.body.slice(httpProxyStart, httpProxyEnd);
    expect(httpProxyBody).toContain(
      "if ((samePortAsStudio || preserveStudioPlatformPaths) && isCoderStudioPlatformPath(url.pathname)) {"
    );
    const webSocketProxyStart = response.body.indexOf("function shouldProxyWebSocketUrl(url) {");
    const webSocketProxyEnd = response.body.indexOf("function toProxyUrl(value, base) {");
    const webSocketProxyBody = response.body.slice(webSocketProxyStart, webSocketProxyEnd);
    expect(webSocketProxyBody).toContain("if (url.host === window.location.host) {");
    expect(webSocketProxyBody).toContain('return !url.pathname.startsWith("/dev-browser/");');
    expect(response.body).toContain('window.location.protocol === "https:" ? "wss:" : "ws:"');
    expect(response.body).toContain("const navigatorOverrides = {");
    expect(response.body).toContain("userAgent: navigatorUserAgent");
    expect(response.body).toContain(userAgent);
    expect(response.body).toContain("platform: /iPhone|iPad|iPod/.test(navigatorUserAgent)");
    expect(response.body).toContain("maxTouchPoints: /Mobile|Android|iPhone|iPad|iPod/.test(");
    expect(response.body).toContain("Object.defineProperty(window.navigator, key, {");
    expect(response.body).not.toContain("throw new Error");
    expect(response.body).toContain(
      `<script src="${created.browserProxyBase}/assets/app.js"></script>`
    );
    expect(response.body).toContain(
      `<link rel="stylesheet" href="${created.browserProxyBase}/assets/app.css">`
    );
    expect(response.body).toContain(`<img src="${created.browserProxyBase}/images/logo.png">`);
    expect(response.body).toContain(`<a href="${created.browserProxyBase}/docs">docs</a>`);
    expect(response.body).toContain(
      `<form action="${created.browserProxyBase}/submit" method="post"></form>`
    );
  });

  it("rewrites css url references for root-relative and loopback absolute assets", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/assets/app.css`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.body).toContain(`url("${created.browserProxyBase}/images/bg.png")`);
    expect(response.body).toContain(`url("${created.browserProxyBase}/images/abs.png")`);
    expect(response.body).toContain("url(./icon.svg)");
  });

  it("rewrites inline module imports in html for fallback mode", async () => {
    const created = await createSession("/vite/");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/vite/`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      `import { injectIntoGlobalHook } from "${created.browserProxyBase}/@react-refresh";`
    );
    expect(response.body).toContain(
      `<script type="module" src="${created.browserProxyBase}/@vite/client"></script>`
    );
    expect(response.body).toContain(
      `<script type="module" src="${created.browserProxyBase}/src/main.tsx"></script>`
    );
    expect(response.body.indexOf("function toProxyWebSocketUrl(value, base)")).toBeGreaterThan(-1);
    expect(response.body.indexOf("function toProxyWebSocketUrl(value, base)")).toBeLessThan(
      response.body.indexOf(
        `<script type="module" src="${created.browserProxyBase}/@vite/client"></script>`
      )
    );
  });

  it("preserves coder studio platform paths in fallback mode for cross-port studio previews", async () => {
    const created = await createSession("/studio/");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/studio/`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("preserveStudioPlatformPaths");
    expect(response.body).toContain(
      "if ((samePortAsStudio || preserveStudioPlatformPaths) && isCoderStudioPlatformPath(url.pathname)) {"
    );
    expect(response.body).toContain("function toPreservedStudioWebSocketUrl(value, base) {");
    expect(response.body).toContain(
      'if (!preserveStudioPlatformPaths || !loopbackHosts.has(parsed.hostname) || parsed.pathname !== "/ws") {'
    );
    expect(response.body).toContain(
      "const resolvedUrl = toPreservedStudioWebSocketUrl(value, window.location.href);"
    );
    expect(response.body).toContain(
      "const proxyUrl = resolvedUrl ?? toProxyWebSocketUrl(value, window.location.href);"
    );
  });

  it("keeps the visible history path on the target route in fallback mode", async () => {
    const created = await createSession("/vite/");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/vite/`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('const visiblePath = session.targetPath || "/";');
    expect(response.body).toContain(
      'nativeReplaceState(window.history.state, "", visiblePath + window.location.hash);'
    );
    expect(response.body).not.toContain("coderStudioDevBrowserPushState");
    expect(response.body).not.toContain("coderStudioDevBrowserReplaceState");
  });

  it("rewrites absolute esm imports inside javascript module responses", async () => {
    const created = await createSession("/vite/");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/src/main.tsx`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain(
      `import React from "${created.browserProxyBase}/node_modules/.vite/deps/react.js?v=1";`
    );
    expect(response.body).toContain(`import App from "${created.browserProxyBase}/src/App.tsx";`);
    expect(response.body).toContain(`import("${created.browserProxyBase}/src/lazy.tsx")`);
  });

  it("proxies static assets and JSON posts", async () => {
    const created = await createSession();
    const asset = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/assets/app.js`,
    });
    const post = await app.inject({
      method: "POST",
      url: `${created.browserProxyBase}/api/echo`,
      headers: { "content-type": "application/json" },
      payload: { ok: true },
    });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(asset.body).toContain("window.loaded");
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ ok: true });
  });

  it("proxies non-JSON request bodies without rewriting them", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "POST",
      url: `${created.browserProxyBase}/api/form`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "name=a%2Bb&ok=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      body: "name=a%2Bb&ok=1",
      contentType: "application/x-www-form-urlencoded",
    });
  });

  it("forwards the session user-agent on proxied http requests", async () => {
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36";
    const created = await createSession("/observe-user-agent", { userAgent });
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/observe-user-agent`,
      headers: {
        "user-agent": "Coder Studio Test Browser",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userAgent });
    expect(observedHttpUserAgent).toBe(userAgent);
  });

  it("keeps protocol-relative-looking proxy paths on the session target", async () => {
    const created = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}//127.0.0.1:1/escape`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ url: "//127.0.0.1:1/escape" });
  });

  it("rewrites loopback redirects to browser proxy paths", async () => {
    const created = await createSession("/redirect");
    const response = await app.inject({
      method: "GET",
      url: `${created.browserProxyBase}/redirect`,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(300);
    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers.location).toBe(`${created.browserProxyBase}/app/`);
  });

  it("proxies websocket text and binary frames", async () => {
    const created = await createSession();
    const socket = await app.injectWS(`${created.browserProxyBase}/ws`);
    const textResponsePromise = waitForMessage(socket);
    socket.send("hello over proxy");
    const textResponse = await textResponsePromise;

    expect(textResponse.isBinary).toBe(false);
    expect(textResponse.data.toString()).toBe("hello over proxy");

    const binaryPayload = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const binaryResponsePromise = waitForMessage(socket);
    socket.send(binaryPayload, { binary: true });
    const binaryResponse = await binaryResponsePromise;

    expect(binaryResponse.isBinary).toBe(true);
    expect(Buffer.from(binaryResponse.data)).toEqual(binaryPayload);

    socket.close();
    await waitForClose(socket);
  });

  it("forwards the session user-agent on proxied websocket upgrades", async () => {
    const userAgent =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36";
    const created = await createSession("/app/", { userAgent });
    const socket = await app.injectWS(`${created.browserProxyBase}/ws-observe-user-agent`);

    await expect(waitForMessage(socket)).resolves.toEqual({
      data: Buffer.from(`user-agent:${userAgent}`),
      isBinary: false,
    });
    expect(observedWsUserAgent).toBe(userAgent);

    socket.close();
    await waitForClose(socket);
  });

  it("propagates upstream websocket closes", async () => {
    const created = await createSession();
    const socket = await app.injectWS(`${created.browserProxyBase}/ws-close`);

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 4001,
      reason: "upstream_done",
    });
  });

  it("closes the browser websocket when the upstream websocket is unavailable", async () => {
    const created = await createSession();
    const socket = await app.injectWS(`${created.browserProxyBase}/missing-ws`);

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 1014,
      reason: "dev_browser_target_unavailable",
    });
  });

  it("proxies the websocket subprotocol selected by the upstream target", async () => {
    const created = await createSession();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("proxy app listen failed");
    }

    const socket = await new Promise<WsWebSocket>((resolve, reject) => {
      const ws = new ClientWebSocket(
        `ws://127.0.0.1:${address.port}${created.browserProxyBase}/ws-protocol`,
        ["json", "superjson"]
      );
      const firstMessagePromise = waitForMessage(ws);

      ws.once("open", async () => {
        try {
          expect(ws.protocol).toBe("superjson");
          await expect(firstMessagePromise).resolves.toEqual({
            data: Buffer.from("protocol:superjson"),
            isBinary: false,
          });
          resolve(ws);
        } catch (error) {
          reject(error);
        }
      });
      ws.once("error", reject);
      ws.once("close", (code, reason) =>
        reject(new Error(`socket closed before open: ${code} ${reason.toString()}`))
      );
      ws.once("unexpected-response", (_request, response) =>
        reject(new Error(`unexpected response: ${response.statusCode}`))
      );
    });
    socket.close();
    await waitForClose(socket);
  });

  it("falls back to the first browser websocket protocol when the upstream target does not override it", async () => {
    const created = await createSession();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("proxy app listen failed");
    }

    const socket = await new Promise<WsWebSocket>((resolve, reject) => {
      const ws = new ClientWebSocket(
        `ws://127.0.0.1:${address.port}${created.browserProxyBase}/ws`,
        ["json", "superjson"]
      );

      ws.once("open", () => {
        try {
          expect(ws.protocol).toBe("json");
          resolve(ws);
        } catch (error) {
          reject(error);
        }
      });
      ws.once("error", reject);
      ws.once("close", (code, reason) =>
        reject(new Error(`socket closed before open: ${code} ${reason.toString()}`))
      );
      ws.once("unexpected-response", (_request, response) =>
        reject(new Error(`unexpected response: ${response.statusCode}`))
      );
    });

    const messagePromise = waitForMessage(socket);
    socket.send("hello over first-protocol proxy");
    await expect(messagePromise).resolves.toEqual({
      data: Buffer.from("hello over first-protocol proxy"),
      isBinary: false,
    });

    socket.close();
    await waitForClose(socket);
  });

  it("bounds buffered browser frames while the upstream websocket is still connecting", async () => {
    const pendingSockets = new Set<NetSocket>();
    const stalledServer = createNetServer((socket) => {
      pendingSockets.add(socket);
      socket.on("close", () => {
        pendingSockets.delete(socket);
      });
    });
    await new Promise<void>((resolve, reject) => {
      stalledServer.once("error", reject);
      stalledServer.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = stalledServer.address();
      if (!address || typeof address === "string") {
        throw new Error("stalled websocket server failed to bind");
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/dev-proxy/session",
        payload: { url: `http://127.0.0.1:${(address as AddressInfo).port}/ws-stall` },
      });
      expect(response.statusCode).toBe(200);

      const created = response.json() as {
        browserProxyBase: string;
      };
      const socket = await app.injectWS(`${created.browserProxyBase}/ws-stall`);

      socket.send(Buffer.alloc(70 * 1024, 1), { binary: true });

      await expect(waitForClose(socket)).resolves.toEqual({
        code: 1009,
        reason: "dev_browser_websocket_buffer_overflow",
      });
    } finally {
      for (const pendingSocket of pendingSockets) {
        pendingSocket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        stalledServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("closes the upstream websocket cleanly when the browser socket terminates abnormally", async () => {
    const created = await createSession();
    const socket = await app.injectWS(`${created.browserProxyBase}/ws-observe-close`);
    const readyMessage = await waitForMessage(socket);

    expect(readyMessage.isBinary).toBe(false);
    expect(readyMessage.data.toString()).toBe("ready");

    socket.terminate();

    await waitForExpectation(() => {
      expect(observedUpstreamClose).not.toBeNull();
    });
  });

  it("rejects websocket upgrades for missing dev-browser sessions", async () => {
    await expect(app.injectWS("/dev-browser/session/missing/proxy/ws")).rejects.toThrow(
      "Unexpected server response: 404"
    );
  });
});
