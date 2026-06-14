import type {
  SupervisorPlanNode,
  SupervisorPlanNodeStatus,
  SupervisorTargetMemory,
} from "@coder-studio/core";
import type { Edge, Node } from "@xyflow/react";

export const SUPERVISOR_MIND_MAP_NODE_WIDTH = 212;
export const SUPERVISOR_MIND_MAP_ROOT_WIDTH = 244;
export const SUPERVISOR_MIND_MAP_NODE_HEIGHT = 92;
export const SUPERVISOR_MIND_MAP_ROOT_HEIGHT = 102;

export interface SupervisorMindMapNodeData extends Record<string, unknown> {
  title: string;
  detail?: string;
  status: SupervisorPlanNodeStatus;
  depth: number;
  isRoot: boolean;
  isActive: boolean;
  isOnActivePath: boolean;
  isSelected: boolean;
  hasChildren: boolean;
  childCount: number;
  expanded: boolean;
  width: number;
  height: number;
}

export type SupervisorMindMapNode = Node<SupervisorMindMapNodeData, "supervisorMindMap">;
export type SupervisorMindMapEdge = Edge<Record<string, never>, "smoothstep">;

export interface SupervisorMindMapGraph {
  nodes: SupervisorMindMapNode[];
  edges: SupervisorMindMapEdge[];
  activeNode: SupervisorPlanNode | null;
  activePath: SupervisorPlanNode[];
  activePathNodeIds: Set<string>;
  expandableNodeIds: string[];
  visibleNodeIds: Set<string>;
}

export function findPlanNodePath(
  node: SupervisorPlanNode | undefined,
  nodeId: string
): SupervisorPlanNode[] | null {
  if (!node) {
    return null;
  }

  if (node.id === nodeId) {
    return [node];
  }

  for (const child of node.children) {
    const childPath = findPlanNodePath(child, nodeId);

    if (childPath) {
      return [node, ...childPath];
    }
  }

  return null;
}

export function findFirstRunnablePath(
  node: SupervisorPlanNode,
  isRoot = false
): SupervisorPlanNode[] | null {
  if (
    !isRoot &&
    node.children.length === 0 &&
    node.status !== "done" &&
    node.status !== "blocked"
  ) {
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

export function resolveActivePlanPath(memory: SupervisorTargetMemory): SupervisorPlanNode[] {
  const root = memory.planTree;
  const activePath = memory.activeNodeId ? findPlanNodePath(root, memory.activeNodeId) : null;

  if (activePath && activePath[activePath.length - 1]?.id !== root.id) {
    return activePath;
  }

  return findFirstRunnablePath(root, true) ?? [root];
}

export function collectExpandableNodeIds(node: SupervisorPlanNode): string[] {
  const childIds = node.children.flatMap((child) => collectExpandableNodeIds(child));
  return node.children.length ? [node.id, ...childIds] : childIds;
}

interface BuildSupervisorMindMapGraphArgs {
  memory: SupervisorTargetMemory;
  rootTitle: string;
  rootDetail?: string;
  expandedNodeIds: Set<string>;
  selectedNodeId?: string | null;
}

function getNodeDetail(args: { node: SupervisorPlanNode; isRoot: boolean; rootDetail?: string }) {
  if (args.isRoot) {
    return args.rootDetail || args.node.deliverable || args.node.objective;
  }

  return args.node.deliverable || args.node.objective;
}

function buildNode(args: {
  node: SupervisorPlanNode;
  depth: number;
  rootTitle: string;
  rootDetail?: string;
  activeNodeId?: string;
  selectedNodeId?: string | null;
  activePathNodeIds: Set<string>;
  expandedNodeIds: Set<string>;
}): SupervisorMindMapNode {
  const isRoot = args.depth === 0;
  const hasChildren = args.node.children.length > 0;
  const width = isRoot ? SUPERVISOR_MIND_MAP_ROOT_WIDTH : SUPERVISOR_MIND_MAP_NODE_WIDTH;
  const height = isRoot ? SUPERVISOR_MIND_MAP_ROOT_HEIGHT : SUPERVISOR_MIND_MAP_NODE_HEIGHT;

  return {
    id: args.node.id,
    type: "supervisorMindMap",
    position: { x: 0, y: 0 },
    width,
    height,
    draggable: false,
    selectable: false,
    deletable: false,
    data: {
      title: isRoot ? args.rootTitle : args.node.title,
      detail: getNodeDetail({
        node: args.node,
        isRoot,
        rootDetail: args.rootDetail,
      }),
      status: args.node.status,
      depth: args.depth,
      isRoot,
      isActive: !isRoot && args.node.id === args.activeNodeId,
      isOnActivePath: args.activePathNodeIds.has(args.node.id),
      isSelected: args.node.id === args.selectedNodeId,
      hasChildren,
      childCount: args.node.children.length,
      expanded: hasChildren && args.expandedNodeIds.has(args.node.id),
      width,
      height,
    },
  };
}

export function buildSupervisorMindMapGraph({
  memory,
  rootTitle,
  rootDetail,
  expandedNodeIds,
  selectedNodeId,
}: BuildSupervisorMindMapGraphArgs): SupervisorMindMapGraph {
  const activePath = resolveActivePlanPath(memory);
  const activePathNodeIds = new Set(activePath.map((node) => node.id));
  const rootId = memory.planTree.id;
  const activeNodeCandidate = activePath[activePath.length - 1] ?? null;
  const activeNode = activeNodeCandidate?.id === rootId ? null : activeNodeCandidate;
  const nodes: SupervisorMindMapNode[] = [];
  const edges: SupervisorMindMapEdge[] = [];
  const visibleNodeIds = new Set<string>();

  function visit(node: SupervisorPlanNode, depth: number, parentId?: string) {
    nodes.push(
      buildNode({
        node,
        depth,
        rootTitle,
        rootDetail,
        activeNodeId: activeNode?.id,
        selectedNodeId,
        activePathNodeIds,
        expandedNodeIds,
      })
    );
    visibleNodeIds.add(node.id);

    if (parentId) {
      edges.push({
        id: `${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
        type: "smoothstep",
        selectable: false,
        deletable: false,
      });
    }

    if (!node.children.length || !expandedNodeIds.has(node.id)) {
      return;
    }

    for (const child of node.children) {
      visit(child, depth + 1, node.id);
    }
  }

  visit(memory.planTree, 0);

  return {
    nodes,
    edges,
    activeNode,
    activePath,
    activePathNodeIds,
    expandableNodeIds: collectExpandableNodeIds(memory.planTree),
    visibleNodeIds,
  };
}
