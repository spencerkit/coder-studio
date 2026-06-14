import type { SupervisorPlanNode, SupervisorTargetMemory } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { SupervisorMindMapFlow } from "./supervisor-mind-map-flow";

type CapturedNode = {
  id: string;
  position: { x: number; y: number };
  data: {
    title: string;
    expanded?: boolean;
  };
};

const fitView = vi.fn();
const zoomTo = vi.fn();
let capturedNodes: CapturedNode[][] = [];

type MockElkGraph = {
  children?: Array<{ id: string }>;
  layoutOptions?: Record<string, string>;
};

vi.mock("@xyflow/react", () => {
  const ReactFlow = ({
    children,
    nodeTypes,
    nodes,
    onNodeClick,
  }: {
    children?: ReactNode;
    nodeTypes?: Record<string, ComponentType<{ data: CapturedNode["data"]; id: string }>>;
    nodes: CapturedNode[];
    onNodeClick?: (event: unknown, node: CapturedNode) => void;
  }) => {
    capturedNodes.push(nodes);
    const NodeComponent = nodeTypes?.supervisorMindMap;

    return (
      <div data-testid="react-flow">
        {nodes.map((node) => (
          <div
            data-node-id={node.id}
            data-node-position={`${node.position.x},${node.position.y}`}
            key={node.id}
          >
            {NodeComponent ? (
              <div onClick={(event) => onNodeClick?.(event, node)}>
                <NodeComponent data={node.data} id={node.id} />
              </div>
            ) : null}
          </div>
        ))}
        {children}
      </div>
    );
  };

  return {
    Controls: () => <div data-testid="controls" />,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    MiniMap: () => <div data-testid="minimap" />,
    Position: { Left: "left", Right: "right" },
    ReactFlow,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ fitView, zoomTo }),
    useViewport: () => ({ zoom: 1 }),
  };
});

vi.mock("elkjs/lib/elk.bundled.js", () => {
  function preservesModelOrder(graph: MockElkGraph) {
    return (
      graph.layoutOptions?.["elk.layered.considerModelOrder.strategy"] === "NODES_AND_EDGES" &&
      graph.layoutOptions?.["elk.layered.crossingMinimization.forceNodeModelOrder"] === "true"
    );
  }

  function orderChildrenForLayout(graph: MockElkGraph) {
    const children = graph.children ?? [];

    if (preservesModelOrder(graph) || !children.some((node) => node.id === "leaf")) {
      return children;
    }

    const unstableOrder = new Map([
      ["root", 0],
      ["active", 1],
      ["branch", 2],
      ["leaf", 3],
    ]);

    return [...children].sort(
      (a, b) => (unstableOrder.get(a.id) ?? 100) - (unstableOrder.get(b.id) ?? 100)
    );
  }

  return {
    default: class MockElk {
      async layout(graph: MockElkGraph) {
        return {
          children: orderChildrenForLayout(graph).map((node, index) => ({
            id: node.id,
            x: index * 120,
            y: index * 40,
          })),
        };
      }
    },
  };
});

function planNode(
  id: string,
  title: string,
  status: SupervisorPlanNode["status"],
  children: SupervisorPlanNode[] = []
): SupervisorPlanNode {
  return {
    id,
    title,
    objective: `${title} objective`,
    deliverable: `${title} deliverable`,
    acceptanceCriteria: [`${title} acceptance`],
    status,
    taskType: "coding",
    children,
  };
}

function targetMemory(): SupervisorTargetMemory {
  return {
    schemaVersion: 2,
    targetId: "target-1",
    planTree: planNode("root", "Root", "in_progress", [
      planNode("branch", "Branch", "pending", [planNode("leaf", "Leaf", "pending")]),
      planNode("active", "Active", "in_progress"),
    ]),
    activeNodeId: "active",
    maxDepth: 6,
    planRevision: 1,
    progressSummary: "Current target summary",
    stalledCount: 0,
    updatedAt: 1,
  };
}

function renderMindMap() {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(
    <Provider store={store}>
      <SupervisorMindMapFlow
        memory={targetMemory()}
        rootTitle="Target root"
        rootDetail="Target summary"
      />
    </Provider>
  );
}

function latestCapturedNodes() {
  return capturedNodes.at(-1) ?? [];
}

function latestNodePosition(nodeId: string) {
  return latestCapturedNodes().find((node) => node.id === nodeId)?.position;
}

describe("SupervisorMindMapFlow", () => {
  beforeEach(() => {
    capturedNodes = [];
    fitView.mockClear();
    zoomTo.mockClear();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();
  });

  it("anchors newly expanded children near their parent before async layout completes", async () => {
    renderMindMap();

    await waitFor(() => {
      expect(latestCapturedNodes().find((node) => node.id === "branch")?.position).toEqual({
        x: 120,
        y: 40,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand Branch" }));

    const leaf = latestCapturedNodes().find((node) => node.id === "leaf");
    expect(leaf?.position).toEqual({ x: 352, y: 40 });

    await waitFor(() => {
      expect(latestCapturedNodes().find((node) => node.id === "leaf")?.position).toEqual({
        x: 240,
        y: 80,
      });
    });
  });

  it("does not refit the viewport for every expand and collapse toggle", async () => {
    renderMindMap();

    await waitFor(() => {
      expect(fitView).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand Branch" }));

    await waitFor(() => {
      expect(latestCapturedNodes().some((node) => node.id === "leaf")).toBe(true);
    });
    expect(fitView).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Branch" }));

    await waitFor(() => {
      expect(latestCapturedNodes().some((node) => node.id === "leaf")).toBe(false);
    });
    expect(fitView).toHaveBeenCalledTimes(1);
  });

  it("keeps existing sibling order stable when a branch is expanded", async () => {
    renderMindMap();

    await waitFor(() => {
      expect(latestNodePosition("branch")?.y).toBeLessThan(latestNodePosition("active")?.y ?? 0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand Branch" }));

    await waitFor(() => {
      expect(latestNodePosition("leaf")?.x).not.toBe(352);
    });

    expect(latestNodePosition("branch")?.y).toBeLessThan(latestNodePosition("active")?.y ?? 0);
  });
});
