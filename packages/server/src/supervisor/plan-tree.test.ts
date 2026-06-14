import type { SupervisorPlanNode, SupervisorTargetMemory } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  applyNodeUpdates,
  attachChildNodes,
  createPlanRoot,
  findNodePath,
  getActiveNodePath,
  markActiveLeafDone,
  resolveActiveNode,
  saveReadyCheckOnNode,
} from "./plan-tree.js";

function node(
  input: Partial<SupervisorPlanNode> & Pick<SupervisorPlanNode, "id" | "title">
): SupervisorPlanNode {
  return {
    id: input.id,
    title: input.title,
    objective: input.objective ?? input.title,
    deliverable: input.deliverable ?? `${input.title} done`,
    acceptanceCriteria: input.acceptanceCriteria ?? [`${input.title} is complete`],
    status: input.status ?? "pending",
    taskType: input.taskType ?? "generic",
    children: input.children ?? [],
    readyCheck: input.readyCheck,
    execution: input.execution,
  };
}

function memory(): SupervisorTargetMemory {
  return {
    schemaVersion: 2,
    targetId: "tgt-1",
    planTree: node({
      id: "root",
      title: "Root",
      status: "in_progress",
      children: [
        node({ id: "a", title: "A", status: "in_progress" }),
        node({ id: "b", title: "B", status: "pending" }),
      ],
    }),
    activeNodeId: "a",
    maxDepth: 6,
    planRevision: 1,
    stalledCount: 0,
    updatedAt: 1,
  };
}

describe("plan-tree helpers", () => {
  it("creates an empty standard root with an opaque plan id", () => {
    const root = createPlanRoot();

    expect(root.id).toMatch(/^plan_/);
    expect(root.children).toEqual([]);
  });

  it("finds a node path by id", () => {
    expect(findNodePath(memory().planTree, "a")?.map((item) => item.id)).toEqual(["root", "a"]);
  });

  it("resolves the active node from memory", () => {
    expect(resolveActiveNode(memory())?.id).toBe("a");
  });

  it("attaches children only to the active parent and updates active node", () => {
    const next = attachChildNodes(
      memory(),
      "a",
      [
        node({ id: "a-1", title: "A1", status: "in_progress", taskType: "writing" }),
        node({ id: "a-2", title: "A2", status: "pending", taskType: "writing" }),
      ],
      10
    );

    expect(next.planTree.children[0]?.children.map((item) => item.id)).toEqual(["a-1", "a-2"]);
    expect(next.planTree.children[1]?.children).toEqual([]);
    expect(next.activeNodeId).toBe("a-1");
    expect(getActiveNodePath(next).map((item) => item.id)).toEqual(["root", "a", "a-1"]);
    expect(next.planRevision).toBe(2);
  });

  it("stores ready check on a node without replacing siblings", () => {
    const next = saveReadyCheckOnNode(
      memory(),
      "a",
      {
        granularity: "too_large",
        reason: "A is too broad",
        checkedAt: 7,
      },
      8
    );

    expect(next.planTree.children[0]?.readyCheck?.reason).toBe("A is too broad");
    expect(next.planTree.children[1]?.readyCheck).toBeUndefined();
  });

  it("applies node status updates without flat item mirrors", () => {
    const next = applyNodeUpdates(memory(), [{ id: "a", status: "done" }], 9);

    expect(next.planTree.children[0]?.status).toBe("done");
    expect(next.planTree.children[1]?.status).toBe("in_progress");
    expect(next.activeNodeId).toBe("b");
    expect(getActiveNodePath(next).map((item) => item.id)).toEqual(["root", "b"]);
  });

  it("marks active leaf done and advances to the next sibling", () => {
    const next = markActiveLeafDone(memory(), "a", 9);

    expect(next.planTree.children[0]?.status).toBe("done");
    expect(next.planTree.children[1]?.status).toBe("in_progress");
    expect(next.activeNodeId).toBe("b");
    expect(getActiveNodePath(next).map((item) => item.id)).toEqual(["root", "b"]);
    expect(next.planRevision).toBe(2);
  });
});
