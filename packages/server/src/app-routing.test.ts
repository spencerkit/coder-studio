import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFastifyApp } from "./app.js";
import { EventBus } from "./bus/event-bus.js";
import { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { WorkspaceRepo } from "./storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { FencingManager } from "./ws/fencing.js";
import { WsHub } from "./ws/hub.js";

describe("app routing", () => {
  let tempDir: string;
  let stateDir: string;
  let app: FastifyInstance;
  let webRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "coder-studio-app-"));
    webRoot = join(tempDir, "web");
    stateDir = join(tempDir, "state-root");

    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(
      join(webRoot, "index.html"),
      '<!doctype html><html><body><div id="root">shell</div></body></html>'
    );
    writeFileSync(join(webRoot, "assets", "app.js"), 'console.log("asset-loaded");');
    writeFileSync(join(webRoot, "task-complete.wav"), "fake-wave");
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createApp = async (
    authEnabled = false,
    extraConfig: Record<string, unknown> = {}
  ): Promise<FastifyInstance> => {
    const eventBus = new EventBus();
    const fencingMgr = new FencingManager();
    const config = {
      host: "127.0.0.1",
      port: 0,
      stateDir,
      uploadsDir: join(tempDir, "uploads"),
      logLevel: "info" as const,
      webRoot,
      auth: {
        enabled: authEnabled,
        password: authEnabled ? "sekrit" : undefined,
      },
      ...extraConfig,
    };
    const wsHub = new WsHub({
      eventBus,
      commandContext: null as never,
      config,
      fencingMgr,
    });

    app = await buildFastifyApp({
      wsHub,
      webRoot,
      workspaceMgr: new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(tempDir, "state", "workspaces.json"),
        }),
        eventBus,
        broadcaster: wsHub,
      }),
      config,
      authSessionRepo: new AuthSessionRepo({
        filePath: join(tempDir, "state", "auth-sessions.json"),
      }),
      authLoginBlockRepo: new AuthLoginBlockRepo({
        filePath: join(tempDir, "state", "auth-login-blocks.json"),
      }),
      logger: false,
    });

    return app;
  };

  it("serves existing asset files as JavaScript modules", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/assets/app.js",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain("asset-loaded");
  });

  it("returns 404 instead of index.html for a missing asset file", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/assets/missing.js",
      headers: {
        accept: "application/javascript",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("<!doctype html>");
  });

  it("returns 404 instead of index.html for the bare /assets namespace", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/assets",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("<!doctype html>");
  });

  it("serves index.html for frontend navigation requests", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/workspaces/demo",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('<div id="root">shell</div>');
  });

  it("serves index.html for the /login frontend route", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/login",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('<div id="root">shell</div>');
  });

  it("serves the built entrypoint when requesting /index.html directly", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/index.html",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('<div id="root">shell</div>');
  });

  it("does not emit a CSP header for the built entrypoint response", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/index.html",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("serves headers for the built entrypoint on HEAD /index.html", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "HEAD",
      url: "/index.html",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("does not fall back to index.html for file-like unknown paths", async () => {
    const instance = await createApp();

    const response = await instance.inject({
      method: "GET",
      url: "/missing.js",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("<!doctype html>");
  });

  it("treats root static files as public even when auth is enabled", async () => {
    const instance = await createApp(true);

    const response = await instance.inject({
      method: "GET",
      url: "/task-complete.wav",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("fake-wave");
  });
});
