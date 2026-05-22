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
    expect(entryRes.body).toContain("demo");
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).toContain("text/css");
    expect(assetRes.body).toContain("color: red");
  });
});
