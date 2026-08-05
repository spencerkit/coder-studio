import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { extname, resolve, sep } from "node:path";
import httpProxy from "http-proxy";

export interface DesktopGatewayOptions {
  backendUrl: string;
  webRoot: string;
  host?: string;
}

export interface DesktopGatewayStatus {
  url: string;
  port: number;
}

const BACKEND_EXACT_PATHS = new Set(["/api", "/auth", "/healthz", "/internal", "/ws"]);
const BACKEND_PREFIXES = ["/api/", "/auth/", "/internal/", "/dev-browser/"];

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getPathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://desktop.local").pathname;
  } catch {
    return "/";
  }
}

export function isBackendGatewayPath(pathname: string): boolean {
  return (
    BACKEND_EXACT_PATHS.has(pathname) ||
    BACKEND_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function resolveStaticPath(webRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const root = resolve(webRoot);
  const relativePath = decoded.replace(/^\/+/, "");
  const candidate = resolve(root, ...relativePath.split("/"));
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

async function resolveWebFile(webRoot: string, pathname: string): Promise<string | null> {
  const candidate = resolveStaticPath(webRoot, pathname === "/" ? "/index.html" : pathname);
  if (candidate) {
    const candidateStat = await stat(candidate).catch(() => null);
    if (candidateStat?.isFile()) return candidate;
  }

  if (extname(pathname)) return null;
  const indexPath = resolveStaticPath(webRoot, "/index.html");
  const indexStat = indexPath ? await stat(indexPath).catch(() => null) : null;
  return indexStat?.isFile() ? indexPath : null;
}

export class DesktopGateway {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly upstreamSockets = new Set<Socket>();
  private backendUrl: string;
  private readonly proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
  });

  constructor(private readonly options: DesktopGatewayOptions) {
    this.backendUrl = options.backendUrl;
    this.proxy.on("error", (_error, _request, responseOrSocket) => {
      if ("writeHead" in responseOrSocket) {
        if (!responseOrSocket.headersSent) {
          responseOrSocket.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        }
        responseOrSocket.end(JSON.stringify({ error: "Desktop backend is unavailable" }));
        return;
      }
      responseOrSocket.destroy();
    });
    this.proxy.on("open", (socket: Socket) => {
      this.upstreamSockets.add(socket);
      socket.once("close", () => this.upstreamSockets.delete(socket));
    });
  }

  async start(): Promise<DesktopGatewayStatus> {
    if (this.server) throw new Error("Desktop Gateway is already running");

    const server = createServer((request, response) => {
      const pathname = getPathname(request.url);
      if (isBackendGatewayPath(pathname)) {
        this.proxy.web(request, response, { target: this.backendUrl });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(404).end();
        return;
      }

      void resolveWebFile(this.options.webRoot, pathname)
        .then((filePath) => {
          if (!filePath) {
            response.writeHead(404).end();
            return;
          }
          const contentType =
            CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
          response.writeHead(200, {
            "cache-control": filePath.endsWith("index.html")
              ? "no-cache"
              : "public, max-age=31536000, immutable",
            "content-type": contentType,
          });
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          createReadStream(filePath).pipe(response);
        })
        .catch(() => response.writeHead(500).end());
    });
    server.on("upgrade", (request, socket, head) => {
      if (getPathname(request.url) !== "/ws") {
        socket.destroy();
        return;
      }
      this.proxy.ws(request, socket, head, { target: this.backendUrl });
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });

    this.server = server;
    const host = this.options.host ?? "127.0.0.1";
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, host, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Desktop Gateway did not expose a TCP address");
    }
    return { url: `http://${host}:${address.port}`, port: address.port };
  }

  setBackendUrl(backendUrl: string): void {
    this.backendUrl = backendUrl;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      const closed = new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      for (const socket of this.sockets) socket.destroy();
      for (const socket of this.upstreamSockets) socket.destroy();
      await closed;
    }
    this.sockets.clear();
    this.upstreamSockets.clear();
    this.proxy.close();
  }
}
