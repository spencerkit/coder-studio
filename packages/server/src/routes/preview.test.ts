import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreviewSessionStore } from "../preview/session-store.js";
import { registerPreviewRoutes } from "./preview.js";

describe("/api/preview/session", () => {
  let app: ReturnType<typeof Fastify>;
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `preview-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(root, "examples", "demo"), { recursive: true });
    await writeFile(join(root, "examples", "demo", "style.css"), "body { color: red; }");

    app = Fastify({ logger: false });
    registerPreviewRoutes(app, {
      previewSessions: new PreviewSessionStore(),
      workspaceMgr: {
        get: (id: string) => (id === "ws-1" ? { path: root } : null),
      } as never,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves the unsaved HTML entry document and its relative CSS asset", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "examples/demo/index.html",
        kind: "html",
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>demo</body></html>',
      },
    });

    const { id, previewUrl } = createRes.json();
    const sessionRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}`,
    });
    const entryRes = await app.inject({ method: "GET", url: `${previewUrl}` });
    const assetRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}/examples/demo/style.css`,
    });

    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.json()).toMatchObject({
      id,
      entryPath: "examples/demo/index.html",
      kind: "html",
      revision: 1,
    });
    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.headers["content-type"]).toContain("text/html");
    expect(entryRes.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("false");
    expect(entryRes.body).toContain("demo");
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).toContain("text/css");
    expect(assetRes.body).toContain("color: red");
  });

  it("rejects invalid preview session payloads", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        entryPath: "examples/demo/index.html",
        kind: "html",
        content: "<h1>demo</h1>",
      },
    });

    expect(createRes.statusCode).toBe(400);
  });

  it("encodes special characters in preview urls", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "docs/guide/intro?draft.md",
        kind: "html",
        content: "<h1>draft</h1>",
      },
    });

    const { previewUrl } = createRes.json();
    expect(previewUrl).toContain("%3F");

    const entryRes = await app.inject({
      method: "GET",
      url: previewUrl,
    });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.body).toContain("draft");
  });

  it("renders markdown sessions as HTML documents", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "docs/guide/intro.md",
        kind: "markdown",
        content: "# Guide",
      },
    });

    const { previewUrl } = createRes.json();
    const entryRes = await app.inject({
      method: "GET",
      url: `${previewUrl}`,
    });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.body).toContain("<h1>Guide</h1>");
  });

  it("returns 404 when a relative asset is missing", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "examples/demo/index.html",
        kind: "html",
        content: "<h1>demo</h1>",
      },
    });

    const { id } = createRes.json();
    const assetRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}/examples/demo/missing.css`,
    });

    expect(assetRes.statusCode).toBe(404);
  });
});
