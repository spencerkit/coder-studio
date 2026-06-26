import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCanvasData } from "./api";

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
