import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
    await writeFile(
      join(root, "examples", "demo", "pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
      )
    );

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

  it("rewrites local HTML image sources through the preview asset route", async () => {
    const fileUrl = pathToFileURL(join(root, "examples", "demo", "pixel.png")).href;
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "examples/demo/index.html",
        kind: "html",
        content: `<!doctype html><html><body><img id="root" src="/examples/demo/pixel.png"><img id="file" src="${fileUrl}"><img id="remote" src="https://example.com/pixel.png"><img id="data" src="data:image/png;base64,abc"></body></html>`,
      },
    });

    const { id, previewUrl } = createRes.json();
    const assetUrl = `/api/preview/session/${id}/examples/demo/pixel.png`;
    const entryRes = await app.inject({ method: "GET", url: previewUrl });
    const assetRes = await app.inject({ method: "GET", url: assetUrl });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.body).toContain(`id="root" src="${assetUrl}"`);
    expect(entryRes.body).toContain(`id="file" src="${assetUrl}"`);
    expect(entryRes.body).toContain('id="remote" src="https://example.com/pixel.png"');
    expect(entryRes.body).toContain('id="data" src="data:image/png;base64,abc"');
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).toContain("image/png");
  });

  it("rewrites local srcset and inline CSS references through the preview asset route", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "examples/demo/index.html",
        kind: "html",
        content:
          '<!doctype html><html><head><style>.hero { background-image: url("/examples/demo/pixel.png?v=1#hero"); } .remote { background-image: url("https://example.com/remote.png"); }</style></head><body><img srcset="/examples/demo/pixel.png 1x, ./pixel.png 2x, https://example.com/remote.png 3x"><div style="background: url(\'/examples/demo/pixel.png\'); mask-image: url(./pixel.png#mask);"></div></body></html>',
      },
    });

    const { id, previewUrl } = createRes.json();
    const assetUrl = `/api/preview/session/${id}/examples/demo/pixel.png`;
    const entryRes = await app.inject({ method: "GET", url: previewUrl });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.body).toContain(`srcset="${assetUrl} 1x, ${assetUrl} 2x`);
    expect(entryRes.body).toContain("https://example.com/remote.png 3x");
    expect(entryRes.body).toContain(`background-image: url("${assetUrl}?v=1#hero")`);
    expect(entryRes.body).toContain(`background: url('${assetUrl}')`);
    expect(entryRes.body).toContain(`mask-image: url(${assetUrl}#mask)`);
    expect(entryRes.body).toContain('url("https://example.com/remote.png")');
  });

  it("rewrites local url() references inside external CSS assets", async () => {
    await writeFile(
      join(root, "examples", "demo", "style.css"),
      '.hero { background-image: url("/examples/demo/pixel.png?v=2#hero"); } .relative { mask-image: url(./pixel.png#mask); } .remote { background-image: url("https://example.com/remote.png"); }'
    );

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

    const { id } = createRes.json();
    const assetUrl = `/api/preview/session/${id}/examples/demo/pixel.png`;
    const cssRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}/examples/demo/style.css`,
    });

    expect(cssRes.statusCode).toBe(200);
    expect(cssRes.headers["content-type"]).toContain("text/css");
    expect(cssRes.body).toContain(`background-image: url("${assetUrl}?v=2#hero")`);
    expect(cssRes.body).toContain(`mask-image: url(${assetUrl}#mask)`);
    expect(cssRes.body).toContain('url("https://example.com/remote.png")');
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

  it("rejects encoded relative asset path escapes", async () => {
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
      url: `/api/preview/session/${id}/..%5C..%5C..%5Csecret.css`,
    });

    expect(assetRes.statusCode).toBe(400);
    expect(assetRes.json()).toEqual({ error: "path_escape" });
  });
});
