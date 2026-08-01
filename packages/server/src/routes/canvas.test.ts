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

  it("returns inspection canvas data by source path as json", async () => {
    const getCanvasInspectionData = vi.fn(async () => ({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      title: "Token Consumption",
      kind: "report_canvas",
      renderStatus: "ready",
      lastError: null,
      overlayDocument: {
        version: 1,
        objects: [],
      },
      anchorCommentDocument: {
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt:10:00"],
            targets: [
              {
                id: "chart-point:prompt:10:00",
                kind: "chart-point",
                rect: { x: 112, y: 40, width: 28, height: 24 },
                label: "Prompt at 10:00",
                payload: {
                  category: "10:00",
                  seriesName: "Prompt",
                  value: 1800,
                },
              },
            ],
            body: "Explain this peak",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      },
      compiledDocument: {
        kind: "report_canvas",
        title: "Token Consumption",
        summary: "Prompt versus completion usage.",
        stats: [],
        sections: [],
      },
    }));

    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData: vi.fn(),
        getCanvasInspectionData,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/inspection?sourcePath=.coder-studio%2Fcanvases%2Ftoken-consumption.csc",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      anchorCommentDocument: {
        comments: [
          expect.objectContaining({
            id: "comment-1",
            targets: [expect.objectContaining({ id: "chart-point:prompt:10:00" })],
          }),
        ],
      },
    });
    expect(getCanvasInspectionData).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace",
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
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

  it("saves overlay annotations by source path", async () => {
    const saveOverlay = vi.fn(async () => ({
      version: 1,
      objects: [
        {
          id: "text-1",
          type: "text",
          color: "#0f172a",
          fontSize: 16,
          x: 18,
          y: 24,
          text: "Review this connection",
        },
      ],
    }));
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData: vi.fn(),
        saveOverlay,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "PUT",
      url: "/api/canvas/ws-1/annotations?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
      payload: {
        version: 1,
        objects: [
          {
            id: "text-1",
            type: "text",
            color: "#0f172a",
            fontSize: 16,
            x: 18,
            y: 24,
            text: "Review this connection",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: 1,
      objects: [expect.objectContaining({ type: "text" })],
    });
    expect(saveOverlay).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      overlayDocument: {
        version: 1,
        objects: [
          {
            id: "text-1",
            type: "text",
            color: "#0f172a",
            fontSize: 16,
            x: 18,
            y: 24,
            text: "Review this connection",
          },
        ],
      },
    });

    await app.close();
  });

  it("saves anchor comments by source path", async () => {
    const saveAnchorComments = vi.fn(async () => ({
      version: 1,
      comments: [
        {
          id: "comment-1",
          elementIds: ["chart-point:prompt:10:00"],
          targets: [
            {
              id: "chart-point:prompt:10:00",
              kind: "chart-point",
              rect: { x: 112, y: 40, width: 28, height: 24 },
              label: "Prompt at 10:00",
              payload: {
                category: "10:00",
                seriesName: "Prompt",
                value: 1800,
              },
            },
          ],
          selectionRect: { x: 112, y: 40, width: 28, height: 24 },
          body: "Explain this peak",
          status: "open",
          createdAt: "2026-06-28T10:00:00.000Z",
          updatedAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    }));
    const app = Fastify({ logger: false });
    registerCanvasRoutes(app, {
      workspaceMgr: {
        get: () => ({ path: "/workspace" }),
      },
      canvasService: {
        getCanvasData: vi.fn(),
        saveAnchorComments,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "PUT",
      url: "/api/canvas/ws-1/comments?sourcePath=.coder-studio%2Fcanvases%2Ftoken-consumption.csc",
      payload: {
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt:10:00"],
            targets: [
              {
                id: "chart-point:prompt:10:00",
                kind: "chart-point",
                rect: { x: 112, y: 40, width: 28, height: 24 },
                label: "Prompt at 10:00",
                payload: {
                  category: "10:00",
                  seriesName: "Prompt",
                  value: 1800,
                },
              },
            ],
            selectionRect: { x: 112, y: 40, width: 28, height: 24 },
            body: "Explain this peak",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: 1,
      comments: [
        expect.objectContaining({
          id: "comment-1",
          targets: [expect.objectContaining({ id: "chart-point:prompt:10:00" })],
        }),
      ],
    });
    expect(saveAnchorComments).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace",
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      anchorCommentDocument: {
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt:10:00"],
            targets: [
              {
                id: "chart-point:prompt:10:00",
                kind: "chart-point",
                rect: { x: 112, y: 40, width: 28, height: 24 },
                label: "Prompt at 10:00",
                payload: {
                  category: "10:00",
                  seriesName: "Prompt",
                  value: 1800,
                },
              },
            ],
            selectionRect: { x: 112, y: 40, width: 28, height: 24 },
            body: "Explain this peak",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      },
    });

    await app.close();
  });
});
