import { describe, expect, it } from "vitest";
import {
  CanvasAnchorCommentDocumentSchema,
  CanvasDataResponseSchema,
  CanvasInspectionResponseSchema,
  CanvasOverlayDocumentSchema,
  CanvasPresetSummarySchema,
  CanvasSceneManifestSchema,
  CanvasSnapshotDataResponseSchema,
  parseCanvasDocumentEnvelope,
} from "./canvas.js";

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

  it.each([
    "line",
    "bar",
    "sparkline",
  ] as const)("parses a report canvas envelope with a %s chart block", (kind) => {
    const parsed = parseCanvasDocumentEnvelope({
      version: 1,
      kind: "report_canvas",
      title: "Weekly Metrics",
      document: {
        summary: "Weekly metrics at a glance.",
        stats: [{ label: "Active users", value: 42 }],
        sections: [
          {
            title: "Usage",
            blocks: [
              {
                type: "chart",
                kind,
                title: "Traffic by day",
                summary: "Desktop traffic over time.",
                unit: "visits",
                showLegend: true,
                categories: ["Mon", "Tue", "Wed"],
                series: [
                  {
                    name: "Desktop",
                    values: [12, 18, 24],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(parsed.kind).toBe("report_canvas");
    expect(parsed.document.sections[0]?.blocks[0]).toMatchObject({
      type: "chart",
      kind,
      title: "Traffic by day",
      categories: ["Mon", "Tue", "Wed"],
      series: [{ name: "Desktop", values: [12, 18, 24] }],
    });
  });

  it("rejects report chart series with mismatched values", () => {
    expect(() =>
      parseCanvasDocumentEnvelope({
        version: 1,
        kind: "report_canvas",
        title: "Weekly Metrics",
        document: {
          summary: "Weekly metrics at a glance.",
          stats: [{ label: "Active users", value: 42 }],
          sections: [
            {
              title: "Usage",
              blocks: [
                {
                  type: "chart",
                  kind: "line",
                  title: "Traffic by day",
                  categories: ["Mon", "Tue", "Wed"],
                  series: [
                    {
                      name: "Desktop",
                      values: [12, 18],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    ).toThrow();
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

  it("parses structured canvas overlay documents", () => {
    expect(
      CanvasOverlayDocumentSchema.parse({
        version: 1,
        objects: [
          {
            id: "stroke-1",
            type: "stroke",
            color: "#ff3366",
            strokeWidth: 3,
            points: [
              { x: 12, y: 18 },
              { x: 20, y: 28 },
            ],
          },
          {
            id: "text-1",
            type: "text",
            color: "#0f172a",
            fontSize: 16,
            x: 48,
            y: 64,
            text: "Investigate this node",
          },
        ],
      })
    ).toMatchObject({
      version: 1,
      objects: [
        expect.objectContaining({ type: "stroke" }),
        expect.objectContaining({ type: "text", text: "Investigate this node" }),
      ],
    });
  });

  it("parses render responses that include overlay annotations", () => {
    expect(
      CanvasDataResponseSchema.parse({
        workspaceId: "ws-1",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        kind: "architecture_canvas",
        renderStatus: "ready",
        lastError: null,
        overlayDocument: {
          version: 1,
          objects: [
            {
              id: "rect-1",
              type: "rect",
              color: "#ff3366",
              strokeWidth: 2,
              x: 24,
              y: 36,
              width: 120,
              height: 80,
            },
          ],
        },
        compiledDocument: {
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [],
        },
      })
    ).toMatchObject({
      overlayDocument: {
        objects: [expect.objectContaining({ type: "rect" })],
      },
    });
  });

  it("parses semantic scene manifests", () => {
    expect(
      CanvasSceneManifestSchema.parse({
        version: 1,
        elements: [
          {
            id: "chart-point:prompt_tokens:10:00",
            kind: "chart-point",
            rect: { x: 120, y: 48, width: 12, height: 12 },
            label: "Prompt at 10:00",
            payload: {
              seriesName: "Prompt",
              category: "10:00",
              value: 1800,
            },
          },
        ],
      })
    ).toMatchObject({
      version: 1,
      elements: [
        expect.objectContaining({
          id: "chart-point:prompt_tokens:10:00",
          kind: "chart-point",
        }),
      ],
    });
  });

  it("parses anchor comment documents", () => {
    expect(
      CanvasAnchorCommentDocumentSchema.parse({
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt_tokens:10:00"],
            targets: [
              {
                id: "chart-point:prompt_tokens:10:00",
                kind: "chart-point",
                rect: { x: 112, y: 40, width: 28, height: 24 },
                label: "Prompt at 10:00",
                payload: {
                  seriesName: "Prompt",
                  category: "10:00",
                  value: 1800,
                },
              },
            ],
            selectionRect: { x: 112, y: 40, width: 28, height: 24 },
            body: "Explain this peak and switch it to warning color.",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      })
    ).toMatchObject({
      version: 1,
      comments: [
        expect.objectContaining({
          id: "comment-1",
          elementIds: ["chart-point:prompt_tokens:10:00"],
          targets: [
            expect.objectContaining({
              id: "chart-point:prompt_tokens:10:00",
              kind: "chart-point",
            }),
          ],
          status: "open",
        }),
      ],
    });
  });

  it("parses inspection responses with semantic context", () => {
    expect(
      CanvasInspectionResponseSchema.parse({
        workspaceId: "ws-1",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        kind: "report_canvas",
        renderStatus: "ready",
        lastError: null,
        overlayDocument: {
          version: 1,
          objects: [
            {
              id: "rect-1",
              type: "rect",
              color: "#ff3366",
              strokeWidth: 2,
              x: 24,
              y: 36,
              width: 120,
              height: 80,
            },
          ],
        },
        sceneManifest: {
          version: 1,
          elements: [
            {
              id: "chart-point:prompt_tokens:10:00",
              kind: "chart-point",
              rect: { x: 120, y: 48, width: 12, height: 12 },
              label: "Prompt at 10:00",
              payload: {
                seriesName: "Prompt",
                category: "10:00",
                value: 1800,
              },
            },
          ],
        },
        anchorCommentDocument: {
          version: 1,
          comments: [
            {
              id: "comment-1",
              elementIds: ["chart-point:prompt_tokens:10:00"],
              targets: [
                {
                  id: "chart-point:prompt_tokens:10:00",
                  kind: "chart-point",
                  rect: { x: 112, y: 40, width: 28, height: 24 },
                  label: "Prompt at 10:00",
                  payload: {
                    seriesName: "Prompt",
                    category: "10:00",
                    value: 1800,
                  },
                },
              ],
              selectionRect: { x: 112, y: 40, width: 28, height: 24 },
              body: "Explain this peak and switch it to warning color.",
              status: "open",
              createdAt: "2026-06-28T10:00:00.000Z",
              updatedAt: "2026-06-28T10:00:00.000Z",
            },
          ],
        },
        compiledDocument: {
          kind: "report_canvas",
          title: "Runtime Flow",
          sections: [],
        },
      })
    ).toMatchObject({
      sceneManifest: {
        elements: [expect.objectContaining({ kind: "chart-point" })],
      },
      anchorCommentDocument: {
        comments: [
          expect.objectContaining({
            id: "comment-1",
            targets: [expect.objectContaining({ id: "chart-point:prompt_tokens:10:00" })],
          }),
        ],
      },
    });
  });

  it("parses canvas preset metadata", () => {
    expect(
      CanvasPresetSummarySchema.parse({
        id: "token-consumption-trend",
        title: "Token Consumption Trend",
        description: "Time-series prompt and completion token usage.",
        kind: "report_canvas",
      })
    ).toMatchObject({
      id: "token-consumption-trend",
      kind: "report_canvas",
    });
  });

  it("parses immutable snapshot responses", () => {
    expect(
      CanvasSnapshotDataResponseSchema.parse({
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
      })
    ).toMatchObject({
      snapshotId: "snapshot_123",
    });
  });
});
