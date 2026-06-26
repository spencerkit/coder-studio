import { describe, expect, it } from "vitest";
import { parseMermaidFlowchart } from "./mermaid-flowchart.js";

describe("parseMermaidFlowchart", () => {
  it("produces labeled nodes and labeled edges", () => {
    const graph = parseMermaidFlowchart(
      "flowchart LR\nWebUI[Web UI] -->|dispatch| Server[Runtime Server]"
    );

    expect(graph).toEqual({
      direction: "LR",
      groups: [],
      nodes: [
        { id: "WebUI", label: "Web UI" },
        { id: "Server", label: "Runtime Server" },
      ],
      edges: [{ from: "WebUI", to: "Server", label: "dispatch" }],
    });
  });

  it("tracks simple subgraphs as groups", () => {
    const graph = parseMermaidFlowchart(
      [
        "flowchart TD",
        "subgraph Client Layer",
        "  WebUI[Web UI]",
        "end",
        "Server[Runtime Server]",
        "WebUI --> Server",
      ].join("\n")
    );

    expect(graph.groups).toEqual([
      {
        id: "client-layer",
        label: "Client Layer",
        nodeIds: ["WebUI"],
      },
    ]);
    expect(graph.direction).toBe("TD");
  });

  it("rejects unsupported flowchart statements", () => {
    expect(() => parseMermaidFlowchart("flowchart LR\nclassDef hot fill:#f00")).toThrow(
      "Unsupported Mermaid flowchart statement"
    );
  });
});
