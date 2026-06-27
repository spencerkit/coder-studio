import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewSessionStore } from "../preview/session-store.js";
import { registerPreviewRoutes } from "./preview.js";

describe("/api/preview/session", () => {
  let app: ReturnType<typeof Fastify>;
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `preview-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(root, "examples", "demo"), { recursive: true });
    await writeFile(join(root, "examples", "demo", "style.css"), "body { color: red; }");
    await writeFile(join(root, "examples", "demo", "app.js"), "window.previewApp = true;");
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
      allowScripts: true,
      revision: 1,
    });
    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.headers["content-type"]).toContain("text/html");
    expect(entryRes.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(entryRes.headers["content-security-policy"]).toContain(
      "script-src-attr 'unsafe-inline'"
    );
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("true");
    expect(entryRes.body).toContain("demo");
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).toContain("text/css");
    expect(assetRes.body).toContain("color: red");
  });

  it("allows same-origin and inline scripts by default while leaving remote scripts blocked by CSP", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "examples/demo/index.html",
        kind: "html",
        content:
          '<!doctype html><html><body><script src="./app.js"></script><script src="https://example.com/app.js"></script><script>window.inlineRan = true;</script><button onclick="window.clicked = true">Run</button></body></html>',
      },
    });

    const { id, previewUrl } = createRes.json();
    const scriptUrl = `/api/preview/session/${id}/examples/demo/app.js`;
    const entryRes = await app.inject({ method: "GET", url: previewUrl });
    const scriptRes = await app.inject({ method: "GET", url: scriptUrl });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("true");
    expect(entryRes.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(entryRes.headers["content-security-policy"]).toContain(
      "script-src-attr 'unsafe-inline'"
    );
    expect(entryRes.body).toContain(`src="${scriptUrl}"`);
    expect(entryRes.body).toContain('src="https://example.com/app.js"');
    expect(entryRes.body).toContain("<script>window.inlineRan = true;</script>");
    expect(entryRes.body).toContain('onclick="window.clicked = true"');
    expect(scriptRes.statusCode).toBe(200);
    expect(scriptRes.body).toContain("window.previewApp = true;");
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

  it("loads WSL preview resources through runtime routing", async () => {
    await app.close();

    const cssBytes = Buffer.from('.hero { background-image: url("./pixel.png#hero"); }', "utf-8");
    const executeOnTarget = vi.fn(async () => ({
      mime: "text/css",
      size: cssBytes.byteLength,
      bytesBase64: cssBytes.toString("base64"),
      workspaceRelativePath: "examples/demo/style.css",
    }));

    app = Fastify({ logger: false });
    registerPreviewRoutes(app, {
      previewSessions: new PreviewSessionStore(),
      workspaceMgr: {
        get: (id: string) =>
          id === "ws-1" ? { path: "/home/spencer/project", targetRuntime: "wsl" } : null,
      } as never,
      runtimeRouter: {
        executeOnTarget,
      } as never,
    });
    await app.ready();

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
    const cssRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}/examples/demo/style.css`,
    });

    expect(cssRes.statusCode).toBe(200);
    expect(cssRes.headers["content-type"]).toContain("text/css");
    expect(cssRes.body).toContain(`/api/preview/session/${id}/examples/demo/pixel.png#hero`);
    expect(executeOnTarget).toHaveBeenCalledWith(
      { kind: "workspace", workspaceId: "ws-1" },
      "file.previewResource.read",
      {
        workspaceId: "ws-1",
        path: "examples/demo/style.css",
      }
    );
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
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("false");
    expect(entryRes.headers["content-security-policy"]).toContain("script-src 'none'");
  });

  it("keeps markdown script execution disabled even when API callers request it", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "docs/guide/intro.md",
        kind: "markdown",
        content: '# Guide\n\n<script src="./app.js"></script>',
        allowScripts: true,
      },
    });

    const { id, previewUrl } = createRes.json();
    const createdSessionRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}`,
    });
    const updatedRes = await app.inject({
      method: "PUT",
      url: `/api/preview/session/${id}`,
      payload: { allowScripts: true },
    });
    const updatedSessionRes = await app.inject({
      method: "GET",
      url: `/api/preview/session/${id}`,
    });
    const entryRes = await app.inject({
      method: "GET",
      url: previewUrl,
    });

    expect(createdSessionRes.json()).toMatchObject({ kind: "markdown", allowScripts: false });
    expect(updatedRes.statusCode).toBe(200);
    expect(updatedSessionRes.json()).toMatchObject({ kind: "markdown", allowScripts: false });
    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("false");
    expect(entryRes.headers["content-security-policy"]).toContain("script-src 'none'");
  });

  it("allows markdown preview scripts only when the document contains mermaid diagrams", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/preview/session",
      payload: {
        workspaceId: "ws-1",
        entryPath: "README.md",
        kind: "markdown",
        content: "```mermaid\ngraph TD\nA[README] --> B[Preview]\n```",
      },
    });

    const { id, previewUrl } = createRes.json();
    const entryRes = await app.inject({
      method: "GET",
      url: previewUrl,
    });
    const runtimeRes = await app.inject({
      method: "GET",
      url: "/api/preview/assets/mermaid.min.js",
    });
    const initRes = await app.inject({
      method: "GET",
      url: "/api/preview/assets/markdown-mermaid-init.js",
    });

    expect(entryRes.statusCode).toBe(200);
    expect(entryRes.headers["x-preview-allow-scripts"]).toBe("true");
    expect(entryRes.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(entryRes.headers["content-security-policy"]).not.toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(entryRes.headers["content-security-policy"]).not.toContain("script-src-attr");
    expect(entryRes.body).toContain('src="/api/preview/assets/mermaid.min.js"');
    expect(entryRes.body).toContain('src="/api/preview/assets/markdown-mermaid-init.js"');
    expect(entryRes.body).not.toContain(
      `/api/preview/session/${id}/api/preview/assets/mermaid.min.js`
    );
    expect(entryRes.body).not.toContain(
      `/api/preview/session/${id}/api/preview/assets/markdown-mermaid-init.js`
    );
    expect(runtimeRes.statusCode).toBe(200);
    expect(runtimeRes.headers["content-type"]).toContain("javascript");
    expect(initRes.statusCode).toBe(200);
    expect(initRes.body).toContain("mermaid.initialize");
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
