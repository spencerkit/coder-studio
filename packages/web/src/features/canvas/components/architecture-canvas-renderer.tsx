import type { CompiledCanvas } from "@coder-studio/core";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import type { CanvasSceneRegistry } from "./canvas-scene-registry";
import { MermaidDiagram } from "./mermaid-diagram";

interface ArchitectureCanvasRendererProps {
  canvas: Extract<CompiledCanvas, { kind: "architecture_canvas" }>;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
}

type ArchitectureDiagramSection = Extract<
  Extract<CompiledCanvas, { kind: "architecture_canvas" }>["sections"][number],
  { type: "diagram" }
>;

function formatDirection(direction: ArchitectureDiagramSection["direction"] | undefined): string {
  switch (direction) {
    case "RL":
      return "Right to left flow";
    case "TB":
    case "TD":
      return "Top to bottom flow";
    case "BT":
      return "Bottom to top flow";
    case "LR":
    default:
      return "Left to right flow";
  }
}

function renderNodeCard(node: { id: string; label?: string }, key: string) {
  return (
    <article
      key={key}
      style={{
        border: "1px solid rgba(31,41,51,0.12)",
        borderRadius: "18px",
        padding: "14px 16px",
        background: "rgba(255,255,255,0.92)",
      }}
    >
      <strong>{node.label ?? node.id}</strong>
      {node.label && node.label !== node.id ? (
        <div style={{ color: "#52606d", fontSize: "0.9rem", marginTop: "4px" }}>{node.id}</div>
      ) : null}
    </article>
  );
}

function renderDiagramDetails(diagram: ArchitectureDiagramSection) {
  const nodeMap = new Map(diagram.nodes.map((node) => [node.id, node] as const));
  const groupedNodeIds = new Set((diagram.groups ?? []).flatMap((group) => group.nodeIds));
  const ungroupedNodes = diagram.nodes.filter((node) => !groupedNodeIds.has(node.id));

  return (
    <>
      <div style={{ display: "grid", gap: "6px" }}>
        <h2 style={{ margin: 0 }}>System Diagram</h2>
        <p style={{ margin: 0, color: "#52606d" }}>{formatDirection(diagram.direction)}</p>
      </div>

      {diagram.groups?.map((group) => (
        <section key={group.id} style={{ display: "grid", gap: "10px" }}>
          <div style={{ display: "grid", gap: "4px" }}>
            <h3 style={{ margin: 0 }}>{group.label}</h3>
            <p style={{ margin: 0, color: "#52606d", fontSize: "0.9rem" }}>
              Contains {group.nodeIds.length} node{group.nodeIds.length === 1 ? "" : "s"}
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            {group.nodeIds.map((nodeId, index) =>
              renderNodeCard(nodeMap.get(nodeId) ?? { id: nodeId }, `${group.id}-${index}`)
            )}
          </div>
        </section>
      ))}

      {ungroupedNodes.length > 0 ? (
        <section style={{ display: "grid", gap: "10px" }}>
          <h3 style={{ margin: 0 }}>Nodes</h3>
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            {ungroupedNodes.map((node) => renderNodeCard(node, node.id))}
          </div>
        </section>
      ) : null}

      <section style={{ display: "grid", gap: "8px" }}>
        <h3 style={{ margin: 0 }}>Connections</h3>
        <div style={{ display: "grid", gap: "8px" }}>
          {diagram.edges.map((edge, index) => (
            <div
              key={`${edge.from}-${edge.to}-${index}`}
              style={{
                borderLeft: "3px solid #0f766e",
                paddingLeft: "12px",
                color: "#334155",
              }}
            >
              <strong>{edge.label ?? `${edge.from} -> ${edge.to}`}</strong>
              <div style={{ color: "#64748b", fontSize: "0.9rem" }}>
                {edge.from}
                {" -> "}
                {edge.to}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function registerMermaidSemanticElements(input: {
  diagram: ArchitectureDiagramSection;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
  mermaidContainer: HTMLDivElement | null;
}) {
  const { diagram, sceneRegistry, sceneRootRef, mermaidContainer } = input;
  const sceneRoot = sceneRootRef?.current ?? null;
  if (!sceneRegistry || !sceneRoot || !mermaidContainer) {
    return;
  }

  const rootRect = sceneRoot.getBoundingClientRect();
  const nodes = mermaidContainer.querySelectorAll("[data-node-id]");
  const edges = mermaidContainer.querySelectorAll("[data-edge-id]");

  nodes.forEach((node) => {
    const nodeId = node.getAttribute("data-node-id");
    if (!nodeId) {
      return;
    }

    const rect = node.getBoundingClientRect();
    const nodeMeta = diagram.nodes.find((item) => item.id === nodeId);
    sceneRegistry.upsertElement({
      id: `mermaid-node:${nodeId}`,
      kind: "mermaid-node",
      rect: {
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      },
      label: nodeMeta?.label ?? nodeId,
      payload: {
        nodeId,
      },
    });
  });

  edges.forEach((edgeElement, index) => {
    const edgeId = edgeElement.getAttribute("data-edge-id");
    const rect = edgeElement.getBoundingClientRect();
    const [from = "", to = ""] = (edgeId ?? "").split(":");
    const edgeMeta = diagram.edges.find((edge) => edge.from === from && edge.to === to);

    sceneRegistry.upsertElement({
      id: `mermaid-edge:${from}:${to}:${index}`,
      kind: "mermaid-edge",
      rect: {
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      },
      label: edgeMeta?.label ?? `${from} -> ${to}`,
      payload: {
        from,
        to,
      },
    });
  });
}

export function ArchitectureCanvasRenderer({
  canvas,
  sceneRegistry,
  sceneRootRef,
}: ArchitectureCanvasRendererProps) {
  const diagram = canvas.sections.find((section) => section.type === "diagram");
  const annotations = canvas.sections.find((section) => section.type === "annotations");
  const mermaidContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!diagram?.mermaidSource) {
      return;
    }

    registerMermaidSemanticElements({
      diagram,
      sceneRegistry,
      sceneRootRef,
      mermaidContainer: mermaidContainerRef.current,
    });
  }, [diagram, sceneRegistry, sceneRootRef]);

  if (!diagram) {
    return (
      <section
        style={{
          border: "1px solid rgba(185,28,28,0.2)",
          borderRadius: "20px",
          padding: "18px",
          background: "rgba(255,255,255,0.84)",
          color: "#7f1d1d",
        }}
      >
        Canvas diagram unavailable.
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <section
        style={{
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: "24px",
          padding: "20px",
          background:
            "linear-gradient(180deg, rgba(252,253,252,0.96) 0%, rgba(244,248,247,0.98) 100%)",
          boxShadow: "0 24px 50px rgba(15, 23, 42, 0.08)",
          display: "grid",
          gap: "16px",
        }}
      >
        {diagram.mermaidSource ? (
          <div ref={mermaidContainerRef}>
            <MermaidDiagram source={diagram.mermaidSource} />
          </div>
        ) : (
          renderDiagramDetails(diagram)
        )}
      </section>

      {annotations && annotations.items.length > 0 ? (
        <section
          style={{
            border: "1px solid rgba(31,41,51,0.12)",
            borderRadius: "20px",
            padding: "18px",
            background: "rgba(255,255,255,0.84)",
            display: "grid",
            gap: "12px",
          }}
        >
          {annotations.items.map((item, index) => (
            <article key={`${item.title}-${index}`}>
              <h3 style={{ margin: "0 0 6px" }}>{item.title}</h3>
              <p style={{ margin: 0, color: "#52606d", lineHeight: 1.6 }}>{item.body}</p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
