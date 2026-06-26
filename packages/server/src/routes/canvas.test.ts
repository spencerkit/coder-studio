import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCanvasRoutes } from "./canvas.js";

describe("/api/canvas", () => {
  it("returns compiled canvas data by source path as json", async () => {
    const getCanvasData = vi.fn(async () => ({
      canvasId: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "architecture_canvas",
        title: "Runtime Flow",
        summary: "How requests move.",
        sections: [],
      },
    }));

    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({
      canvasId: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      renderStatus: "ready",
    });
    expect(getCanvasData).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    await app.close();
  });

  it("returns not found when the workspace is missing", async () => {
    const getCanvasData = vi.fn();
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => null,
      },
      canvasService: {
        getCanvasData,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "workspace_not_found",
    });
    expect(getCanvasData).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns bad request when sourcePath is missing", async () => {
    const getCanvasData = vi.fn();
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "source_path_required",
    });
    expect(getCanvasData).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns not found when the canvas is missing", async () => {
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData: async () => {
          throw { code: "canvas_not_found", message: "Canvas not found: canvas-1" };
        },
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data?sourcePath=.coder-studio%2Fcanvases%2Fmissing-flow.csc",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "canvas_not_found",
    });

    await app.close();
  });

  it("returns bad request when sourcePath escapes the workspace", async () => {
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData: async () => {
          throw { code: "path_escape", message: "Path escapes workspace root" };
        },
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data?sourcePath=..%2Fsecret",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "path_escape",
    });

    await app.close();
  });
});
