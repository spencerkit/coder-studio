// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchitectureCanvasRenderer } from "./architecture-canvas-renderer";

vi.mock("./mermaid-diagram", () => ({
  MermaidDiagram: ({ source }: { source: string }) => (
    <div data-testid="mermaid-svg">
      <span>{source}</span>
      <svg>
        <g className="node" data-node-id="WebUI">
          <rect />
          <text>Web UI</text>
        </g>
        <g className="node" data-node-id="Server">
          <rect />
          <text>Runtime Server</text>
        </g>
        <g className="edgePath" data-edge-id="WebUI:Server">
          <path />
        </g>
      </svg>
    </div>
  ),
}));

const { createCanvasSceneRegistry } = await import("./canvas-scene-registry");

function createRect(
  input: Partial<DOMRect> & { left: number; top: number; width: number; height: number }
) {
  return {
    x: input.left,
    y: input.top,
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    right: input.left + input.width,
    bottom: input.top + input.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function ArchitectureSceneHarness(props: {
  onManifestChange: (manifest: {
    version: 1;
    elements: Array<{
      id: string;
      kind: string;
      rect: { x: number; y: number; width: number; height: number };
      payload?: Record<string, unknown>;
    }>;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sceneRegistry] = useState(() => createCanvasSceneRegistry());

  useEffect(
    () => sceneRegistry.subscribe(props.onManifestChange),
    [props.onManifestChange, sceneRegistry]
  );

  return (
    <div data-scene-root="true" ref={rootRef}>
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
        sceneRegistry={sceneRegistry}
        sceneRootRef={rootRef}
      />
    </div>
  );
}

describe("ArchitectureCanvasRenderer", () => {
  let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    getBoundingClientRectSpy?.mockRestore();
    getBoundingClientRectSpy = undefined;
  });

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

  it("registers mermaid node and edge semantic elements", async () => {
    getBoundingClientRectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function mockGetBoundingClientRect(this: Element) {
        if ((this as HTMLElement).dataset?.sceneRoot === "true") {
          return createRect({ left: 10, top: 20, width: 960, height: 720 });
        }

        const dataNodeId = (this as HTMLElement).getAttribute("data-node-id");
        const dataEdgeId = (this as HTMLElement).getAttribute("data-edge-id");
        if (dataNodeId === "WebUI") {
          return createRect({ left: 40, top: 60, width: 120, height: 48 });
        }

        if (dataNodeId === "Server") {
          return createRect({ left: 240, top: 60, width: 160, height: 48 });
        }

        if (dataEdgeId === "WebUI:Server") {
          return createRect({ left: 160, top: 72, width: 90, height: 18 });
        }

        return createRect({ left: 0, top: 0, width: 0, height: 0 });
      });

    const onManifestChange = vi.fn();
    render(<ArchitectureSceneHarness onManifestChange={onManifestChange} />);

    await waitFor(() => {
      const manifest = onManifestChange.mock.calls[onManifestChange.mock.calls.length - 1]?.[0];
      expect(manifest).toBeDefined();
      expect(manifest.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "mermaid-node:WebUI",
            kind: "mermaid-node",
            rect: { x: 30, y: 40, width: 120, height: 48 },
            payload: expect.objectContaining({ nodeId: "WebUI" }),
          }),
          expect.objectContaining({
            id: "mermaid-node:Server",
            kind: "mermaid-node",
            rect: { x: 230, y: 40, width: 160, height: 48 },
            payload: expect.objectContaining({ nodeId: "Server" }),
          }),
          expect.objectContaining({
            id: "mermaid-edge:WebUI:Server:0",
            kind: "mermaid-edge",
            rect: { x: 150, y: 52, width: 90, height: 18 },
            payload: expect.objectContaining({ from: "WebUI", to: "Server" }),
          }),
        ])
      );
    });
  });
});
