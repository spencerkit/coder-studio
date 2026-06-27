import { type ReportChartKind, ReportChartKindSchema } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { compileCanvasDocument } from "./compiler.js";

function createReportChartBlock(kind: ReportChartKind) {
  return {
    type: "chart" as const,
    kind,
    title: "Package trends",
    summary: "Packages over time.",
    unit: "packages",
    categories: ["Jan", "Feb"],
    series: [{ name: "Packages", values: [6, 7] }],
    showLegend: true,
  };
}

describe("compileCanvasDocument", () => {
  it("produces an architecture_canvas render model", () => {
    const compiled = compileCanvasDocument({
      version: 1,
      kind: "architecture_canvas",
      title: "Runtime Flow",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: ["WebUI[Web UI]", "Server[Runtime Server]", "WebUI -->|dispatch| Server"].join(
            "\n"
          ),
        },
        annotations: [{ title: "Boundary", body: "Server owns execution." }],
      },
    });

    expect(compiled).toEqual({
      kind: "architecture_canvas",
      title: "Runtime Flow",
      summary: "How requests move.",
      sections: [
        {
          type: "diagram",
          mermaidSource: [
            "WebUI[Web UI]",
            "Server[Runtime Server]",
            "WebUI -->|dispatch| Server",
          ].join("\n"),
          direction: undefined,
          groups: [],
          nodes: [
            { id: "WebUI", label: "Web UI" },
            { id: "Server", label: "Runtime Server" },
          ],
          edges: [{ from: "WebUI", to: "Server", label: "dispatch" }],
        },
        {
          type: "annotations",
          items: [{ title: "Boundary", body: "Server owns execution." }],
        },
      ],
    });
  });

  it("stringifies report stats values", () => {
    const compiled = compileCanvasDocument({
      version: 1,
      kind: "report_canvas",
      title: "Audit",
      document: {
        summary: "Workspace audit.",
        stats: [{ label: "Packages", value: 6, tone: "info" }],
        sections: [
          {
            title: "Findings",
            blocks: [
              { type: "markdown", markdown: "Server owns rendering." },
              {
                type: "stats",
                items: [{ label: "Packages", value: 6 }],
              },
            ],
          },
        ],
      },
    });

    expect(compiled).toEqual({
      kind: "report_canvas",
      title: "Audit",
      sections: [
        {
          type: "stats",
          items: [{ label: "Packages", value: "6", tone: "info" }],
        },
        {
          type: "section",
          title: "Findings",
          blocks: [
            { type: "markdown", markdown: "Server owns rendering." },
            {
              type: "stats",
              items: [{ label: "Packages", value: "6", tone: undefined }],
            },
          ],
        },
      ],
    });
  });

  it.each(
    ReportChartKindSchema.options
  )("preserves a %s chart block when compiling report canvases", (kind) => {
    const chartBlock = createReportChartBlock(kind);
    const compiled = compileCanvasDocument({
      version: 1,
      kind: "report_canvas",
      title: "Audit",
      document: {
        summary: "Workspace audit.",
        stats: [],
        sections: [
          {
            title: "Findings",
            blocks: [
              { type: "markdown", markdown: "Server owns rendering." },
              chartBlock,
              {
                type: "callout",
                tone: "info",
                title: "Ownership",
                body: "Charts stay in their original position.",
              },
            ],
          },
        ],
      },
    });

    expect(compiled.kind).toBe("report_canvas");
    expect(compiled.title).toBe("Audit");
    expect(compiled.sections).toHaveLength(2);
    expect(compiled.sections.map((section) => section.type)).toEqual(["stats", "section"]);
    expect(compiled.sections[0]).toEqual({
      type: "stats",
      items: [],
    });
    expect(compiled.sections[1]).toMatchObject({
      type: "section",
      title: "Findings",
    });
    expect(compiled.sections[1]?.blocks.map((block) => block.type)).toEqual([
      "markdown",
      "chart",
      "callout",
    ]);
    expect(compiled.sections[1]?.blocks[1]).toEqual(chartBlock);
  });

  it("uses Mermaid flowchart compilation for Mermaid architecture canvases", () => {
    const compiled = compileCanvasDocument({
      version: 1,
      kind: "architecture_canvas",
      title: "Runtime Flow",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] -->|dispatch| Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    expect(compiled).toEqual({
      kind: "architecture_canvas",
      title: "Runtime Flow",
      summary: "How requests move.",
      sections: [
        {
          type: "diagram",
          mermaidSource: "flowchart LR\nWebUI[Web UI] -->|dispatch| Server[Runtime Server]",
          direction: "LR",
          groups: [],
          nodes: [
            { id: "WebUI", label: "Web UI" },
            { id: "Server", label: "Runtime Server" },
          ],
          edges: [{ from: "WebUI", to: "Server", label: "dispatch" }],
        },
        {
          type: "annotations",
          items: [],
        },
      ],
    });
  });
});
