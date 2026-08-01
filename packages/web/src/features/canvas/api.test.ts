import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCanvasData,
  fetchCanvasInspectionData,
  fetchCanvasSnapshotData,
  saveCanvasAnchorComments,
  saveCanvasOverlay,
} from "./api";

describe("fetchCanvasData", () => {
  const originalFetch = globalThis.fetch;
  const sourcePath = ".coder-studio/canvases/runtime-flow.csc";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a valid canvas payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        workspaceId: "ws-1",
        sourcePath,
        title: "Runtime Flow",
        kind: "architecture_canvas",
        renderStatus: "ready",
        lastError: null,
        overlayDocument: {
          version: 1,
          objects: [],
        },
        compiledDocument: {
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "diagram",
              nodes: [{ id: "web", label: "Web UI" }],
              edges: [],
            },
            {
              type: "annotations",
              items: [],
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await fetchCanvasData("ws-1", sourcePath);

    expect(result.sourcePath).toBe(sourcePath);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/canvas/ws-1/data?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
      {
        credentials: "include",
      }
    );
  });

  it("rejects malformed canvas payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        canvasId: "canvas-1",
        renderStatus: "ready",
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCanvasData("ws-1", sourcePath)).rejects.toThrow("canvas_response_invalid");
  });

  it("rejects invalid json payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCanvasData("ws-1", sourcePath)).rejects.toThrow("canvas_response_invalid");
  });

  it("rejects architecture payloads without a diagram section", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        workspaceId: "ws-1",
        sourcePath,
        title: "Runtime Flow",
        kind: "architecture_canvas",
        renderStatus: "ready",
        lastError: null,
        compiledDocument: {
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "annotations",
              items: [{ title: "Boundary", body: "Server owns execution." }],
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCanvasData("ws-1", sourcePath)).rejects.toThrow("canvas_response_invalid");
  });
});

describe("fetchCanvasSnapshotData", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a valid canvas snapshot payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        snapshotId: "snapshot_123",
        workspaceId: "ws-1",
        title: "Weekly Metrics",
        kind: "report_canvas",
        createdAt: 123456,
        sourceHash: "abc123",
        compiledDocument: {
          kind: "report_canvas",
          title: "Weekly Metrics",
          sections: [],
        },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await fetchCanvasSnapshotData("snapshot_123");

    expect(result.snapshotId).toBe("snapshot_123");
    expect(fetchMock).toHaveBeenCalledWith("/api/canvas-snapshots/snapshot_123", {
      credentials: "include",
    });
  });

  it("rejects malformed snapshot payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        snapshotId: "snapshot_123",
        title: "Weekly Metrics",
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(fetchCanvasSnapshotData("snapshot_123")).rejects.toThrow(
      "canvas_response_invalid"
    );
  });
});

describe("saveCanvasOverlay", () => {
  const originalFetch = globalThis.fetch;
  const sourcePath = ".coder-studio/canvases/runtime-flow.csc";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("saves overlay annotations through the canvas api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
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
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await saveCanvasOverlay("ws-1", sourcePath, {
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
    });

    expect(result.objects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/canvas/ws-1/annotations?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
      expect.objectContaining({
        credentials: "include",
        method: "PUT",
      })
    );
  });
});

describe("fetchCanvasInspectionData", () => {
  const originalFetch = globalThis.fetch;
  const sourcePath = ".coder-studio/canvases/token-consumption.csc";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a valid inspection payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        workspaceId: "ws-1",
        sourcePath,
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
              selectionRect: { x: 112, y: 40, width: 28, height: 24 },
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
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await fetchCanvasInspectionData("ws-1", sourcePath);

    expect(result.anchorCommentDocument?.comments).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/canvas/ws-1/inspection?sourcePath=.coder-studio%2Fcanvases%2Ftoken-consumption.csc",
      {
        credentials: "include",
      }
    );
  });
});

describe("saveCanvasAnchorComments", () => {
  const originalFetch = globalThis.fetch;
  const sourcePath = ".coder-studio/canvases/token-consumption.csc";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("saves anchor comments through the canvas api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt:10:00"],
            selectionRect: { x: 112, y: 40, width: 28, height: 24 },
            body: "Explain this peak",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await saveCanvasAnchorComments("ws-1", sourcePath, {
      version: 1,
      comments: [
        {
          id: "comment-1",
          elementIds: ["chart-point:prompt:10:00"],
          selectionRect: { x: 112, y: 40, width: 28, height: 24 },
          body: "Explain this peak",
          status: "open",
          createdAt: "2026-06-28T10:00:00.000Z",
          updatedAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    });

    expect(result.comments).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/canvas/ws-1/comments?sourcePath=.coder-studio%2Fcanvases%2Ftoken-consumption.csc",
      expect.objectContaining({
        credentials: "include",
        method: "PUT",
      })
    );
  });
});
