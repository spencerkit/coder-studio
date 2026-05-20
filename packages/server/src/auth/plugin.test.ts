import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFastifyApp } from "../app.js";
import { EventBus } from "../bus/event-bus.js";
import type { Database } from "../storage/database.js";
import { openDatabase } from "../storage/db.js";
import { AuthLoginBlockRepo } from "../storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "../storage/repositories/auth-session-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { FencingManager } from "../ws/fencing.js";
import { WsHub } from "../ws/hub.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("auth login protection", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database;
  let app: FastifyInstance;
  let webRoot: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "coder-studio-auth-"));
    dbPath = join(tempDir, "auth.db");
    webRoot = join(tempDir, "web");
    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(
      join(webRoot, "index.html"),
      '<!doctype html><html><body><div id="root">shell</div></body></html>'
    );
    db = openDatabase(dbPath);

    const eventBus = new EventBus();
    const fencingMgr = new FencingManager();
    const config = {
      host: "127.0.0.1",
      port: 0,
      dataDir: dbPath,
      uploadsDir: join(tempDir, "uploads"),
      logLevel: "info" as const,
      webRoot,
      auth: {
        enabled: true,
        password: "sekrit",
      },
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
        workspaceRepo: new WorkspaceRepo(db),
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
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (db?.isOpen) {
      db.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks an IP for 24 hours after 10 failed logins within 24 hours", async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.24, 10.0.0.2",
        },
        payload: { password: "wrong-password" },
      });

      expect(response.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.24, 10.0.0.2",
      },
      payload: { password: "sekrit" },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      ok: false,
      blocked: true,
      error: "Too many failed attempts",
      ip: "198.51.100.24",
    });
    expect(blocked.json()).toHaveProperty("blockedUntil");
  });

  it("clears previous failures after a successful login", async () => {
    for (let index = 0; index < 9; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.19",
        },
        payload: { password: "bad-password" },
      });

      expect(response.statusCode).toBe(401);
    }

    const success = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.19",
      },
      payload: { password: "sekrit" },
    });

    expect(success.statusCode).toBe(200);

    for (let index = 0; index < 9; index += 1) {
      const retry = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.19",
        },
        payload: { password: "bad-password" },
      });

      expect(retry.statusCode).toBe(401);
    }

    const stillAllowed = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.19",
      },
      payload: { password: "sekrit" },
    });

    expect(stillAllowed.statusCode).toBe(200);
  });

  it("uses the first X-Forwarded-For IP for block tracking", async () => {
    for (let index = 0; index < 10; index += 1) {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.80, 10.10.0.1, 10.10.0.2",
        },
        payload: { password: "wrong-password" },
      });
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.80, 10.10.0.1, 10.10.0.2",
      },
      payload: { password: "sekrit" },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      ip: "192.0.2.80",
    });
  });

  it("blocks when the tenth failure lands exactly on the trailing 24 hour boundary", async () => {
    const baseTime = 1_000_000_000_000;
    const timestamps = [
      baseTime,
      baseTime + 1,
      baseTime + 2,
      baseTime + 3,
      baseTime + 4,
      baseTime + 5,
      baseTime + 6,
      baseTime + 7,
      baseTime + 8,
      baseTime + DAY_MS,
      baseTime + DAY_MS + 1,
    ];
    let timestampIndex = 0;
    const originalDateNow = Date.now;
    Date.now = () => timestamps[timestampIndex] ?? timestamps[timestamps.length - 1];

    try {
      for (let index = 0; index < 10; index += 1) {
        timestampIndex = index;
        const response = await app.inject({
          method: "POST",
          url: "/auth/login",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.99",
          },
          payload: { password: "wrong-password" },
        });

        expect(response.statusCode).toBe(401);
      }

      timestampIndex = 10;
      const blocked = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.99",
        },
        payload: { password: "sekrit" },
      });

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({
        ip: "198.51.100.99",
        blocked: true,
      });
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("does not treat dotted backend paths as public static files", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/internal/openapi.json",
      headers: {
        accept: "application/json",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: "Authentication required",
    });
  });

  it("does not redirect bare reserved backend namespaces to the auth page", async () => {
    const apiResponse = await app.inject({
      method: "GET",
      url: "/api",
      headers: {
        accept: "text/html",
      },
    });

    const internalResponse = await app.inject({
      method: "GET",
      url: "/internal",
      headers: {
        accept: "text/html",
      },
    });

    expect(apiResponse.statusCode).toBe(401);
    expect(apiResponse.json()).toMatchObject({
      ok: false,
      error: "Authentication required",
    });

    expect(internalResponse.statusCode).toBe(401);
    expect(internalResponse.json()).toMatchObject({
      ok: false,
      error: "Authentication required",
    });
  });

  it("does not treat the legacy /auth frontend path as a login redirect target", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: "Authentication required",
    });
  });

  it("does not treat unknown /auth/* paths as frontend navigations", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/unknown",
      headers: {
        accept: "text/html",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      ok: false,
      error: "Authentication required",
    });
  });

  it("does not fall through to the SPA for GET /auth/login or GET /auth/logout", async () => {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/auth/login",
      headers: {
        accept: "text/html",
      },
    });

    const logoutResponse = await app.inject({
      method: "GET",
      url: "/auth/logout",
      headers: {
        accept: "text/html",
      },
    });

    expect(loginResponse.statusCode).toBe(404);
    expect(logoutResponse.statusCode).toBe(404);
  });
});
