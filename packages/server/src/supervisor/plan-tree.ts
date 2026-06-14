import { randomUUID } from "node:crypto";
import type {
  SupervisorCycleNodeUpdate,
  SupervisorPlanNode,
  SupervisorPlanNodeReadyCheck,
  SupervisorPlanNodeStatus,
  SupervisorTargetMemory,
} from "@coder-studio/core";

type NodeMapper = (node: SupervisorPlanNode) => SupervisorPlanNode;

export function createPlanRootId(): string {
  return `plan_${randomUUID().replace(/-/g, "")}`;
}

export function createPlanRoot(): SupervisorPlanNode {
  return {
    id: createPlanRootId(),
    title: "Supervisor target",
    objective: "Complete the supervised target",
    deliverable: "Completed target",
    acceptanceCriteria: ["Target objective is complete"],
    status: "pending",
    taskType: "generic",
    children: [],
  };
}

function clonePlanNode(
  node: SupervisorPlanNode,
  rootId: string,
  isRoot = false
): SupervisorPlanNode {
  const nextId = isRoot ? rootId : node.id;
  return {
    ...node,
    id: nextId,
    children: node.children.map((child) => clonePlanNode(child, rootId)),
  };
}

export function clonePlanTreeWithRoot(
  node: SupervisorPlanNode,
  rootId = createPlanRootId()
): SupervisorPlanNode {
  return clonePlanNode(node, rootId, true);
}

export function findNodePath(
  root: SupervisorPlanNode,
  nodeId: string
): SupervisorPlanNode[] | null {
  if (root.id === nodeId) {
    return [root];
  }
  for (const child of root.children) {
    const path = findNodePath(child, nodeId);
    if (path) {
      return [root, ...path];
    }
  }
  return null;
}

export function getActiveNodePath(memory: SupervisorTargetMemory): SupervisorPlanNode[] {
  const byActive =
    memory.activeNodeId && memory.activeNodeId !== memory.planTree.id
      ? findNodePath(memory.planTree, memory.activeNodeId)
      : null;
  if (byActive) {
    return byActive;
  }
  const first = findFirstRunnablePath(memory.planTree);
  return first ?? [memory.planTree];
}

export function resolveActiveNode(memory: SupervisorTargetMemory): SupervisorPlanNode | null {
  const path = getActiveNodePath(memory);
  return path[path.length - 1] ?? null;
}

export function attachChildNodes(
  memory: SupervisorTargetMemory,
  targetNodeId: string,
  children: SupervisorPlanNode[],
  updatedAt: number
): SupervisorTargetMemory {
  const normalizedChildren: SupervisorPlanNode[] = children.map((child, index) => ({
    ...child,
    status:
      index === 0
        ? ("in_progress" as const)
        : child.status === "done"
          ? ("done" as const)
          : ("pending" as const),
    children: child.children ?? [],
  }));
  const activeNodeId =
    normalizedChildren.find((child) => child.status === "in_progress")?.id ??
    normalizedChildren.find((child) => child.status === "pending")?.id ??
    normalizedChildren[0]?.id;
  let root = mapNode(memory.planTree, targetNodeId, (node) => ({
    ...node,
    status: "in_progress",
    children: normalizedChildren,
  }));

  if (activeNodeId) {
    root = markPathInProgress(root, activeNodeId);
  }

  return {
    ...memory,
    planTree: rollupStatuses(root),
    activeNodeId,
    planRevision: memory.planRevision + 1,
    updatedAt,
  };
}

export function saveReadyCheckOnNode(
  memory: SupervisorTargetMemory,
  nodeId: string,
  readyCheck: SupervisorPlanNodeReadyCheck,
  updatedAt: number
): SupervisorTargetMemory {
  return {
    ...memory,
    planTree: mapNode(memory.planTree, nodeId, (node) => ({ ...node, readyCheck })),
    updatedAt,
  };
}

export function saveExecutionOnNode(
  memory: SupervisorTargetMemory,
  nodeId: string,
  guidance: string,
  updatedAt: number
): SupervisorTargetMemory {
  return {
    ...memory,
    planTree: mapNode(memory.planTree, nodeId, (node) => ({
      ...node,
      execution: { executable: true, guidance, lastInjectedAt: updatedAt },
    })),
    lastGuidance: guidance,
    updatedAt,
  };
}

export function applyNodeUpdates(
  memory: SupervisorTargetMemory,
  updates: SupervisorCycleNodeUpdate[],
  updatedAt: number
): SupervisorTargetMemory {
  let root = memory.planTree;
  for (const update of updates) {
    root = mapNode(root, update.id, (node) => ({ ...node, status: update.status }));
  }

  let nextMemory: SupervisorTargetMemory = {
    ...memory,
    planTree: rollupStatuses(root),
    updatedAt,
  };

  if (
    memory.activeNodeId &&
    updates.some((update) => update.id === memory.activeNodeId && update.status === "done")
  ) {
    nextMemory = activateFirstRunnable(nextMemory, updatedAt);
  } else {
    nextMemory = ensureActiveNodeRunnable(nextMemory, updatedAt);
  }

  return {
    ...nextMemory,
    planRevision: memory.planRevision + 1,
  };
}

export function markActiveLeafDone(
  memory: SupervisorTargetMemory,
  nodeId: string,
  updatedAt: number
): SupervisorTargetMemory {
  const root = mapNode(memory.planTree, nodeId, (node) => ({ ...node, status: "done" }));
  const nextMemory: SupervisorTargetMemory = {
    ...memory,
    planTree: rollupStatuses(root),
    updatedAt,
  };
  const activated = activateFirstRunnable(nextMemory, updatedAt);
  return {
    ...activated,
    planRevision: memory.planRevision + 1,
  };
}

function ensureActiveNodeRunnable(
  memory: SupervisorTargetMemory,
  updatedAt: number
): SupervisorTargetMemory {
  const activeNode = memory.activeNodeId
    ? findNodePath(memory.planTree, memory.activeNodeId)?.at(-1)
    : null;

  if (activeNode && activeNode.status !== "done" && activeNode.status !== "blocked") {
    return {
      ...memory,
      planTree:
        activeNode.status === "pending"
          ? markPathInProgress(memory.planTree, activeNode.id)
          : memory.planTree,
      updatedAt,
    };
  }

  return activateFirstRunnable(memory, updatedAt);
}

function activateFirstRunnable(
  memory: SupervisorTargetMemory,
  updatedAt: number
): SupervisorTargetMemory {
  const nextPath = findFirstRunnablePath(memory.planTree);
  const nextActiveId = nextPath?.[nextPath.length - 1]?.id;
  const nextRoot = nextActiveId
    ? markPathInProgress(memory.planTree, nextActiveId)
    : memory.planTree;
  return {
    ...memory,
    planTree: nextRoot,
    activeNodeId: nextActiveId,
    updatedAt,
  };
}

function mapNode(node: SupervisorPlanNode, nodeId: string, mapper: NodeMapper): SupervisorPlanNode {
  if (node.id === nodeId) {
    return mapper(node);
  }
  return {
    ...node,
    children: node.children.map((child) => mapNode(child, nodeId, mapper)),
  };
}

function findFirstRunnablePath(node: SupervisorPlanNode): SupervisorPlanNode[] | null {
  if (node.children.length === 0 && node.status !== "done" && node.status !== "blocked") {
    return [node];
  }
  for (const child of node.children) {
    if (child.status === "done" || child.status === "blocked") {
      continue;
    }
    const childPath = findFirstRunnablePath(child);
    if (childPath) {
      return [node, ...childPath];
    }
  }
  return null;
}

function markPathInProgress(root: SupervisorPlanNode, nodeId: string): SupervisorPlanNode {
  const pathIds = new Set(findNodePath(root, nodeId)?.map((node) => node.id) ?? []);
  return mapTree(root, (node) => {
    if (!pathIds.has(node.id) || node.status === "done" || node.status === "blocked") {
      return node;
    }
    return { ...node, status: "in_progress" };
  });
}

function mapTree(node: SupervisorPlanNode, mapper: NodeMapper): SupervisorPlanNode {
  const mapped = mapper(node);
  return {
    ...mapped,
    children: mapped.children.map((child) => mapTree(child, mapper)),
  };
}

function rollupStatuses(node: SupervisorPlanNode): SupervisorPlanNode {
  const children = node.children.map((child) => rollupStatuses(child));
  if (children.length === 0) {
    return { ...node, children };
  }

  const nextStatus: SupervisorPlanNodeStatus = children.every((child) => child.status === "done")
    ? "done"
    : children.some((child) => child.status === "in_progress")
      ? "in_progress"
      : children.every((child) => child.status === "blocked")
        ? "blocked"
        : node.status === "in_progress"
          ? "in_progress"
          : "pending";

  return {
    ...node,
    children,
    status: nextStatus,
  };
}
