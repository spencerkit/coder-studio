// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchitectureCanvasRenderer } from "./architecture-canvas-renderer";

vi.mock("./mermaid-diagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => <div data-testid="mermaid-svg">{source}</div>,
}));

describe("ArchitectureCanvasRenderer", () => {
  it("renders a fallback when no diagram section is present", () => {
    render(
      <ArchitectureCanvasRenderer
        canvas={{
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "annotations",
              items: [{ title: "Boundary", body: "Server owns execution." }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Canvas diagram unavailable.")).toBeInTheDocument();
  });

  it("renders a mermaid diagram when mermaidSource is available", async () => {
    render(
      <ArchitectureCanvasRenderer
        canvas={{
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "diagram",
              mermaidSource: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
              direction: "LR",
              nodes: [
                { id: "WebUI", label: "Web UI" },
                { id: "Server", label: "Runtime Server" },
              ],
              edges: [{ from: "WebUI", to: "Server" }],
            },
            {
              type: "annotations",
              items: [{ title: "Boundary", body: "Server owns execution." }],
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    expect(screen.getByTestId("mermaid-svg")).toHaveTextContent(/flowchart LR/);
    expect(screen.queryByText("System Diagram")).not.toBeInTheDocument();
    expect(screen.getByText("Boundary")).toBeInTheDocument();
  });

  it("renders compiled groups instead of inferred role layers when mermaidSource is absent", () => {
    render(
      <ArchitectureCanvasRenderer
        canvas={{
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "diagram",
              direction: "LR",
              groups: [
                {
                  id: "execution-cluster",
                  label: "Execution Cluster",
                  nodeIds: ["alpha", "beta"],
                },
              ],
              nodes: [
                { id: "alpha", label: "Alpha Node" },
                { id: "beta", label: "Beta Node" },
              ],
              edges: [{ from: "alpha", to: "beta", label: "dispatch" }],
            },
            {
              type: "annotations",
              items: [{ title: "Boundary", body: "Server owns execution." }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Execution Cluster")).toBeInTheDocument();
    expect(screen.getByText("Contains 2 nodes")).toBeInTheDocument();
    expect(screen.queryByText("Data layer")).not.toBeInTheDocument();
  });

  it("renders diagram nodes, edges, and annotations when mermaidSource is absent", () => {
    render(
      <ArchitectureCanvasRenderer
        canvas={{
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [
            {
              type: "diagram",
              direction: "LR",
              nodes: [
                { id: "web", label: "Web UI" },
                { id: "server", label: "Server Runtime" },
                { id: "provider", label: "Model Provider" },
              ],
              edges: [
                { from: "web", to: "server", label: "dispatch" },
                { from: "server", to: "provider", label: "run command" },
              ],
            },
            {
              type: "annotations",
              items: [{ title: "Boundary", body: "Server owns execution." }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("System Diagram")).toBeInTheDocument();
    expect(screen.getByText("Left to right flow")).toBeInTheDocument();
    expect(screen.getByText("Nodes")).toBeInTheDocument();
    expect(screen.getByText("Web UI")).toBeInTheDocument();
    expect(screen.getByText("Server Runtime")).toBeInTheDocument();
    expect(screen.getByText("Model Provider")).toBeInTheDocument();
    expect(screen.getByText("dispatch")).toBeInTheDocument();
    expect(screen.getByText("run command")).toBeInTheDocument();
    expect(screen.getByText("Boundary")).toBeInTheDocument();
    expect(screen.getByText("Server owns execution.")).toBeInTheDocument();
  });
});
