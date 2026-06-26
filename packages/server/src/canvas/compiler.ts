import type { CanvasDocumentEnvelope, CompiledCanvas } from "@coder-studio/core";
import { parseMermaidFlowchart } from "./mermaid-flowchart.js";

export function compileCanvasDocument(document: CanvasDocumentEnvelope): CompiledCanvas {
  if (document.kind === "architecture_canvas") {
    const graph = parseMermaidFlowchart(document.document.diagram.source);

    return {
      kind: "architecture_canvas",
      title: document.title,
      summary: document.document.summary,
      sections: [
        {
          type: "diagram",
          mermaidSource: document.document.diagram.source,
          direction: graph.direction,
          groups: graph.groups,
          nodes: graph.nodes,
          edges: graph.edges,
        },
        {
          type: "annotations",
          items: document.document.annotations,
        },
      ],
    };
  }

  return {
    kind: "report_canvas",
    title: document.title,
    sections: [
      {
        type: "stats",
        items: document.document.stats.map((stat) => ({
          label: stat.label,
          value: String(stat.value),
          tone: stat.tone,
        })),
      },
      ...document.document.sections.map((section) => ({
        type: "section" as const,
        title: section.title,
        blocks: section.blocks.map((block) =>
          block.type === "stats"
            ? {
                ...block,
                items: block.items.map((item) => ({
                  label: item.label,
                  value: String(item.value),
                  tone: item.tone,
                })),
              }
            : block
        ),
      })),
    ],
  };
}
