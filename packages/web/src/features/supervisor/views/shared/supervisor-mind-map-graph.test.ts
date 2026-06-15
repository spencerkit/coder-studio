import type { SupervisorPlanNode, SupervisorTargetMemory } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  buildSupervisorMindMapGraph,
  collectExpandableNodeIds,
  resolveActivePlanPath,
} from "./supervisor-mind-map-graph";

function node(
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

function memory(planTree: SupervisorPlanNode, activeNodeId?: string): SupervisorTargetMemory {
  return {
    schemaVersion: 2,
    targetId: "target-1",
    planTree,
    activeNodeId,
    maxDepth: 6,
    planRevision: 1,
    progressSummary: "Current target summary",
    stalledCount: 0,
    updatedAt: 1,
  };
}

describe("supervisor mind map graph", () => {
  it("resolves an explicit active node path", () => {
    const root = node("root", "Root", "in_progress", [
      node("done", "Done", "done"),
      node("parent", "Parent", "in_progress", [node("leaf", "Leaf", "in_progress")]),
    ]);

    expect(resolveActivePlanPath(memory(root, "leaf")).map((entry) => entry.id)).toEqual([
      "root",
      "parent",
      "leaf",
    ]);
  });

  it("falls back to the first runnable leaf when activeNodeId is missing", () => {
    const root = node("root", "Root", "in_progress", [
      node("done", "Done", "done"),
      node("blocked", "Blocked", "blocked"),
      node("parent", "Parent", "in_progress", [node("leaf", "Leaf", "pending")]),
    ]);

    expect(resolveActivePlanPath(memory(root)).map((entry) => entry.id)).toEqual([
      "root",
      "parent",
      "leaf",
    ]);
  });

  it("collects expandable node ids in tree order", () => {
    const root = node("root", "Root", "in_progress", [
      node("a", "A", "pending", [node("a-1", "A1", "pending")]),
      node("b", "B", "pending"),
    ]);

    expect(collectExpandableNodeIds(root)).toEqual(["root", "a"]);
  });

  it("builds visible React Flow nodes and edges from the expanded tree", () => {
    const root = node("root", "Root", "in_progress", [
      node("inactive", "Inactive", "pending", [node("inactive-leaf", "Inactive leaf", "pending")]),
      node("active-parent", "Active parent", "in_progress", [
        node("active-leaf", "Active leaf", "in_progress"),
      ]),
    ]);

    const graph = buildSupervisorMindMapGraph({
      memory: memory(root, "active-leaf"),
      rootTitle: "Reduce mobile regression bugs",
      rootDetail: "Target summary",
      expandedNodeIds: new Set(["root", "active-parent"]),
    });

    expect(graph.nodes.map((entry) => entry.id)).toEqual([
      "root",
      "inactive",
      "active-parent",
      "active-leaf",
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "root", target: "inactive" }),
      expect.objectContaining({ source: "root", target: "active-parent" }),
      expect.objectContaining({ source: "active-parent", target: "active-leaf" }),
    ]);
    expect(graph.expandableNodeIds).toEqual(["root", "inactive", "active-parent"]);
    expect(graph.activeNode?.id).toBe("active-leaf");
    expect(graph.activePath.map((entry) => entry.id)).toEqual([
      "root",
      "active-parent",
      "active-leaf",
    ]);
    expect(graph.activePathNodeIds).toEqual(new Set(["root", "active-parent", "active-leaf"]));
    expect(graph.visibleNodeIds.has("inactive-leaf")).toBe(false);
    expect(graph.nodes[0]?.data).toEqual(
      expect.objectContaining({
        title: "Reduce mobile regression bugs",
        detail: "Target summary",
        isRoot: true,
        expanded: true,
      })
    );
    expect(graph.nodes.find((entry) => entry.id === "active-leaf")?.data).toEqual(
      expect.objectContaining({
        isActive: true,
        isOnActivePath: true,
      })
    );
  });

  it("marks the selected node separately from the active path", () => {
    const root = node("root", "Root", "in_progress", [
      node("active-parent", "Active parent", "in_progress", [
        node("active-leaf", "Active leaf", "in_progress"),
      ]),
      node("selected", "Selected", "pending"),
    ]);

    const graph = buildSupervisorMindMapGraph({
      memory: memory(root, "active-leaf"),
      rootTitle: "Reduce mobile regression bugs",
      rootDetail: "Target summary",
      expandedNodeIds: new Set(["root", "active-parent"]),
      selectedNodeId: "selected",
    });

    expect(graph.nodes.find((entry) => entry.id === "active-leaf")?.data).toEqual(
      expect.objectContaining({
        isActive: true,
        isSelected: false,
      })
    );
    expect(graph.nodes.find((entry) => entry.id === "selected")?.data).toEqual(
      expect.objectContaining({
        isActive: false,
        isSelected: true,
      })
    );
  });
});
