import { describe, expect, it } from "vitest";
import { CanvasDataResponseSchema, parseCanvasDocumentEnvelope } from "./canvas.js";

describe("canvas domain", () => {
  it("parses an architecture canvas envelope", () => {
    const parsed = parseCanvasDocumentEnvelope({
      version: 1,
      kind: "architecture_canvas",
      title: "Runtime Flow",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [{ title: "Boundary", body: "Server owns execution." }],
      },
    });

    expect(parsed.kind).toBe("architecture_canvas");
    expect(parsed.document.diagram.dsl).toBe("mermaid");
  });

  it("rejects ready responses without a compiled document", () => {
    const result = CanvasDataResponseSchema.safeParse({
      canvasId: "canvas-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
    });

    expect(result.success).toBe(false);
  });

  it("requires sourcePath for canvas render responses", () => {
    expect(() =>
      CanvasDataResponseSchema.parse({
        workspaceId: "ws-1",
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
      })
    ).toThrow();

    expect(
      CanvasDataResponseSchema.parse({
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
      })
    ).toMatchObject({
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });
  });
});
