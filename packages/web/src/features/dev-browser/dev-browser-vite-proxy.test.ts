// @vitest-environment node

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(new URL("../../../../server/package.json", import.meta.url));
const { WebSocket, WebSocketServer } = require("ws") as typeof import("ws");

function createBackendServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ server: ReturnType<typeof createHttpServer>; url: string }>(
    (resolve, reject) => {
      const server = createHttpServer(handler);
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("backend test server failed to bind"));
          return;
        }
        resolve({ server, url: `http://127.0.0.1:${address.port}` });
      });
    }
  );
}

describe("dev browser vite proxy", () => {
  const originalBackendHttpUrl = process.env.VITE_BACKEND_HTTP_URL;
  const originalBackendWsUrl = process.env.VITE_BACKEND_WS_URL;
  let backendServer: ReturnType<typeof createHttpServer> | null = null;
  let backendWsServer: WebSocketServer | null = null;
  let viteServer: ViteDevServer | null = null;
  let vitePort = 0;

  beforeAll(async () => {
    const backend = await createBackendServer((req, res) => {
      if (req.url === "/dev-browser/session/test/") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<!doctype html><html><body>proxied dev browser session</body></html>");
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("backend fallback");
    });
    backendServer = backend.server;
    backendWsServer = new WebSocketServer({ noServer: true });
    backendWsServer.on("connection", (socket) => {
      socket.send(`protocol:${socket.protocol || "none"}`);
      socket.on("message", (data) => {
        socket.send(`backend:${data.toString()}`);
      });
    });
    backendServer.on("upgrade", (req, socket, head) => {
      if (req.url !== "/dev-browser/session/test/proxy/ws") {
        socket.destroy();
        return;
      }

      backendWsServer?.handleUpgrade(req, socket, head, (ws) => {
        backendWsServer?.emit("connection", ws, req);
      });
    });

    process.env.VITE_BACKEND_HTTP_URL = backend.url;
    process.env.VITE_BACKEND_WS_URL = backend.url.replace("http://", "ws://");

    viteServer = await createServer({
      configFile: "./vite.config.ts",
      logLevel: "silent",
      optimizeDeps: {
        noDiscovery: true,
      },
      server: {
        host: "127.0.0.1",
        port: 0,
      },
    });

    await viteServer.listen();
    const address = viteServer.httpServer?.address() as AddressInfo | null;
    if (!address) {
      throw new Error("vite test server failed to bind");
    }
    vitePort = address.port;
  });

  afterAll(async () => {
    process.env.VITE_BACKEND_HTTP_URL = originalBackendHttpUrl;
    process.env.VITE_BACKEND_WS_URL = originalBackendWsUrl;
    await viteServer?.close();
    await new Promise<void>((resolve, reject) => {
      if (!backendServer) {
        resolve();
        return;
      }
      backendServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("serves the dev browser service worker from public assets instead of proxying it", async () => {
    const response = await fetch(`http://127.0.0.1:${vitePort}/dev-browser-sw.js`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(body).toContain("coder-studio-dev-browser-session");
    expect(body).not.toContain("backend fallback");
  });

  it("continues proxying dev browser session routes to the backend", async () => {
    const response = await fetch(`http://127.0.0.1:${vitePort}/dev-browser/session/test/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("proxied dev browser session");
  });

  it("proxies dev browser websocket upgrades to the backend", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${vitePort}/dev-browser/session/test/proxy/ws`);
    const ready = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });

    await new Promise<void>((resolve) => {
      ws.once("open", () => resolve());
    });

    expect(await ready).toBe("protocol:none");

    const echoed = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });

    ws.send("hello");
    expect(await echoed).toBe("backend:hello");
    ws.terminate();
  });

  it("proxies websocket subprotocol negotiation through the vite dev proxy", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${vitePort}/dev-browser/session/test/proxy/ws`,
      "vite-hmr"
    );
    const ready = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });

    await new Promise<void>((resolve) => {
      ws.once("open", () => resolve());
    });

    expect(ws.protocol).toBe("vite-hmr");

    expect(await ready).toBe("protocol:vite-hmr");
    ws.terminate();
  });
});
