import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopGateway, isBackendGatewayPath } from "./gateway.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => entry()));
});

describe("isBackendGatewayPath", () => {
  it("separates backend namespaces from shared Web routes", () => {
    expect(isBackendGatewayPath("/api/workspaces")).toBe(true);
    expect(isBackendGatewayPath("/auth/login")).toBe(true);
    expect(isBackendGatewayPath("/ws")).toBe(true);
    expect(isBackendGatewayPath("/settings")).toBe(false);
    expect(isBackendGatewayPath("/assets/app.js")).toBe(false);
  });
});

describe("DesktopGateway", () => {
  it("serves the shared Web and proxies backend HTTP routes", async () => {
    const webRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-gateway-test-"));
    cleanup.push(() => rm(webRoot, { recursive: true, force: true }));
    await mkdir(resolve(webRoot, "assets"));
    await writeFile(resolve(webRoot, "index.html"), "<html>shared-web</html>");
    await writeFile(resolve(webRoot, "assets/app.js"), "console.log('shared-web')");

    const backend = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ path: request.url, host: request.headers.host }));
    });
    await new Promise<void>((resolveListen) => backend.listen(0, "127.0.0.1", resolveListen));
    cleanup.push(() => new Promise<void>((resolveClose) => backend.close(() => resolveClose())));
    const backendAddress = backend.address();
    if (!backendAddress || typeof backendAddress === "string") throw new Error("No test address");

    const gateway = new DesktopGateway({
      backendUrl: `http://127.0.0.1:${backendAddress.port}`,
      webRoot,
    });
    const status = await gateway.start();
    cleanup.push(() => gateway.stop());

    await expect(fetch(`${status.url}/settings`).then((response) => response.text())).resolves.toBe(
      "<html>shared-web</html>"
    );
    await expect(
      fetch(`${status.url}/assets/app.js`).then((response) => response.text())
    ).resolves.toBe("console.log('shared-web')");
    await expect(
      fetch(`${status.url}/api/test`).then((response) => response.json())
    ).resolves.toMatchObject({ path: "/api/test" });
  });

  it("proxies WebSocket upgrades to the active backend", async () => {
    const webRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-gateway-ws-test-"));
    cleanup.push(() => rm(webRoot, { recursive: true, force: true }));
    await writeFile(resolve(webRoot, "index.html"), "<html>shared-web</html>");

    let upgradedPath: string | undefined;
    const backend = createServer();
    const backendSockets = new Set<ReturnType<typeof createConnection>>();
    backend.on("connection", (socket) => {
      backendSockets.add(socket);
      socket.once("close", () => backendSockets.delete(socket));
    });
    backend.on("upgrade", (request, socket) => {
      upgradedPath = request.url;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
      );
    });
    await new Promise<void>((resolveListen) => backend.listen(0, "127.0.0.1", resolveListen));
    cleanup.push(async () => {
      for (const socket of backendSockets) socket.destroy();
    });
    cleanup.push(() => new Promise<void>((resolveClose) => backend.close(() => resolveClose())));
    const backendAddress = backend.address();
    if (!backendAddress || typeof backendAddress === "string") throw new Error("No test address");

    const gateway = new DesktopGateway({
      backendUrl: `http://127.0.0.1:${backendAddress.port}`,
      webRoot,
    });
    const status = await gateway.start();
    let gatewayStopped = false;
    cleanup.push(() => (gatewayStopped ? Promise.resolve() : gateway.stop()));

    const upgraded = await new Promise<{
      response: string;
      socket: ReturnType<typeof createConnection>;
    }>((resolveResponse, rejectResponse) => {
      const socket = createConnection(status.port, "127.0.0.1");
      socket.once("error", rejectResponse);
      socket.once("connect", () => {
        socket.write(
          [
            "GET /ws HTTP/1.1",
            `Host: 127.0.0.1:${status.port}`,
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "",
            "",
          ].join("\r\n")
        );
      });
      socket.once("data", (chunk) => {
        resolveResponse({ response: chunk.toString("utf8"), socket });
      });
    });

    expect(upgraded.response).toContain("101 Switching Protocols");
    expect(upgradedPath).toBe("/ws");
    const clientClosed = new Promise<void>((resolveClose) =>
      upgraded.socket.once("close", () => resolveClose())
    );
    await gateway.stop();
    await clientClosed;
    gatewayStopped = true;
    expect(upgraded.socket.destroyed).toBe(true);
  });
});
