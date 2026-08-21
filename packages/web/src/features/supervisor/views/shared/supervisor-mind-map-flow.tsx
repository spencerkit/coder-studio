import type { SupervisorPlanNodeStatus, SupervisorTargetMemory } from "@coder-studio/core";
import {
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton, Tag, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  buildSupervisorMindMapGraph,
  type SupervisorMindMapEdge,
  type SupervisorMindMapGraph,
  type SupervisorMindMapNode,
} from "./supervisor-mind-map-graph";

interface SupervisorMindMapFlowProps {
  readonly memory: SupervisorTargetMemory;
  readonly rootTitle: string;
  readonly rootDetail?: string;
  readonly selectedNodeId?: string | null;
  readonly onInspectNode?: (nodeId: string) => void;
}

const PLAN_STATUS_TAG_COLOR: Record<
  SupervisorPlanNodeStatus,
  "blue" | "green" | "amber" | "neutral"
> = {
  blocked: "amber",
  done: "green",
  in_progress: "blue",
  pending: "neutral",
};

const MIND_MAP_MIN_ZOOM = 0.45;
const MIND_MAP_MAX_ZOOM = 1.8;
const MIND_MAP_FIT_MAX_ZOOM = 1.15;
const MIND_MAP_FIT_PADDING = 0.09;
const MIND_MAP_VIEWPORT_DURATION = 180;
const MIND_MAP_MINIMAP_SIZE = { width: 154, height: 104 };
const MIND_MAP_EXPAND_ANCHOR_GAP = 20;

const elk = new ELK();

interface MindMapNodePosition {
  x: number;
  y: number;
}

type SupervisorMindMapDomAttributes = NonNullable<SupervisorMindMapNode["domAttributes"]> & {
  "data-active-node"?: "true";
  "data-active-path"?: "true";
  "data-plan-status"?: SupervisorPlanNodeStatus;
  "data-root-node"?: "true";
  "data-selected-node"?: "true";
};

function formatMindMapZoom(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getStatusLabel(args: {
  status: SupervisorPlanNodeStatus;
  isRoot: boolean;
  isActive: boolean;
  hasChildren: boolean;
  t: ReturnType<typeof useTranslation>;
}): string {
  if (args.isRoot) {
    return args.t("supervisor.target_memory.goal_node_status");
  }

  if (args.isActive) {
    return args.t("supervisor.target_memory.current_execution");
  }

  if (args.status === "in_progress") {
    return args.t(
      args.hasChildren
        ? "supervisor.target_memory.branch_open_status"
        : "supervisor.target_memory.open_status"
    );
  }

  return args.t(`supervisor.target_memory.step_status.${args.status}`);
}

function getStatusColor(args: {
  status: SupervisorPlanNodeStatus;
  isRoot: boolean;
  isActive: boolean;
}): "blue" | "green" | "amber" | "neutral" {
  if (args.isRoot || args.isActive) {
    return "blue";
  }

  if (args.status === "in_progress") {
    return "neutral";
  }

  return PLAN_STATUS_TAG_COLOR[args.status];
}

interface SupervisorMindMapFlowNodeProps extends NodeProps<SupervisorMindMapNode> {
  readonly onToggleNode: (nodeId: string) => void;
}

function SupervisorMindMapFlowNode({ data, id, onToggleNode }: SupervisorMindMapFlowNodeProps) {
  const t = useTranslation();
  const statusLabel = getStatusLabel({
    status: data.status,
    isRoot: data.isRoot,
    isActive: data.isActive,
    hasChildren: data.hasChildren,
    t,
  });
  const statusColor = getStatusColor({
    status: data.status,
    isRoot: data.isRoot,
    isActive: data.isActive,
  });
  const toggleLabel = `${data.expanded ? t("action.collapse") : t("action.expand")} ${data.title}`;

  return (
    <div
      className="supervisor-mind-map-flow__node"
      data-active-node={data.isActive ? "true" : undefined}
      data-active-path={data.isOnActivePath ? "true" : undefined}
      data-depth={data.depth}
      data-expanded={data.expanded ? "true" : undefined}
      data-has-children={data.hasChildren ? "true" : undefined}
      data-plan-status={data.status}
      data-root-node={data.isRoot ? "true" : undefined}
      data-selected-node={data.isSelected ? "true" : undefined}
      style={{ width: data.width, height: data.height }}
    >
      <Handle
        className="supervisor-mind-map-flow__handle"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />
      <div className="supervisor-mind-map-flow__node-header">
        <span
          aria-hidden="true"
          className={`supervisor-mind-map-flow__marker supervisor-mind-map-flow__marker--${data.status}`}
        />
        <div className="supervisor-mind-map-flow__node-copy">
          <p className="supervisor-mind-map-flow__node-title">{data.title}</p>
          {data.detail ? (
            <p className="supervisor-mind-map-flow__node-detail">{data.detail}</p>
          ) : null}
        </div>
        {data.hasChildren ? (
          <Tooltip content={toggleLabel}>
            <IconButton
              aria-expanded={data.expanded}
              aria-label={toggleLabel}
              className="supervisor-mind-map-flow__node-toggle nodrag nopan"
              icon={data.expanded ? <Minus size={14} /> : <Plus size={14} />}
              onClick={(event) => {
                event.stopPropagation();
                onToggleNode(id);
              }}
              size="sm"
            />
          </Tooltip>
        ) : null}
      </div>
      <div className="supervisor-mind-map-flow__node-meta">
        <Tag
          className={`supervisor-mind-map-flow__node-status${
            data.isActive ? " supervisor-mind-map-flow__node-status--current" : ""
          }`}
          color={statusColor}
          size="sm"
          caps={false}
        >
          {statusLabel}
        </Tag>
        {data.hasChildren ? (
          <span className="supervisor-mind-map-flow__child-count">
            {t("supervisor.target_memory.child_count", { count: data.childCount })}
          </span>
        ) : null}
      </div>
      <Handle
        className="supervisor-mind-map-flow__handle"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

function createNodeTypes(onToggleNode: (nodeId: string) => void): NodeTypes {
  return {
    supervisorMindMap: (props) => (
      <SupervisorMindMapFlowNode
        {...(props as NodeProps<SupervisorMindMapNode>)}
        onToggleNode={onToggleNode}
      />
    ),
  };
}

function decorateSupervisorMindMapNodes(nodes: SupervisorMindMapNode[]): SupervisorMindMapNode[] {
  return nodes.map((node) => ({
    ...node,
    ariaLabel: node.data.title,
    ariaRole: "treeitem",
    className: "supervisor-mind-map-flow__react-node",
    connectable: false,
    domAttributes: {
      "aria-expanded": node.data.hasChildren ? node.data.expanded : undefined,
      "aria-level": node.data.depth + 1,
      "data-active-node": node.data.isActive ? "true" : undefined,
      "data-active-path": node.data.isOnActivePath ? "true" : undefined,
      "data-plan-status": node.data.status,
      "data-root-node": node.data.isRoot ? "true" : undefined,
      "data-selected-node": node.data.isSelected ? "true" : undefined,
    },
    focusable: true,
    sourcePosition: Position.Right,
    style: {
      width: node.data.width,
      height: node.data.height,
    },
    targetPosition: Position.Left,
  }));
}

function rememberSupervisorMindMapNodePositions(
  currentPositions: Map<string, MindMapNodePosition>,
  nodes: SupervisorMindMapNode[]
): Map<string, MindMapNodePosition> {
  const nextPositions = new Map(currentPositions);

  for (const node of nodes) {
    nextPositions.set(node.id, {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    });
  }

  return nextPositions;
}

function createAnchoredSupervisorMindMapNodes(args: {
  edges: SupervisorMindMapEdge[];
  nodes: SupervisorMindMapNode[];
  previousPositions: Map<string, MindMapNodePosition>;
}): SupervisorMindMapNode[] {
  const decoratedNodes = decorateSupervisorMindMapNodes(args.nodes);
  const parentIdByNodeId = new Map(args.edges.map((edge) => [edge.target, edge.source]));
  const nodeById = new Map(decoratedNodes.map((node) => [node.id, node]));
  const nextPositions = new Map<string, MindMapNodePosition>();

  return decoratedNodes.map((node) => {
    const previousPosition = args.previousPositions.get(node.id);

    if (previousPosition) {
      nextPositions.set(node.id, previousPosition);
      return {
        ...node,
        position: previousPosition,
      };
    }

    const parentId = parentIdByNodeId.get(node.id);
    const parentPosition = parentId
      ? (nextPositions.get(parentId) ?? args.previousPositions.get(parentId))
      : undefined;
    const parentNode = parentId ? nodeById.get(parentId) : undefined;
    const anchoredPosition =
      parentPosition && parentNode
        ? {
            x: Math.round(parentPosition.x + parentNode.data.width + MIND_MAP_EXPAND_ANCHOR_GAP),
            y: Math.round(parentPosition.y),
          }
        : {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          };

    nextPositions.set(node.id, anchoredPosition);
    return {
      ...node,
      position: anchoredPosition,
    };
  });
}

async function layoutSupervisorMindMapGraph(
  graph: SupervisorMindMapGraph
): Promise<SupervisorMindMapNode[]> {
  const elkGraph: ElkNode = {
    id: "supervisor-mind-map",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "54",
      "elk.spacing.nodeNode": "20",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: node.data.width,
      height: node.data.height,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layout = await elk.layout(elkGraph);
  const positions = new Map(
    layout.children?.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]) ?? []
  );

  return decorateSupervisorMindMapNodes(graph.nodes).map((node) => {
    const position = positions.get(node.id) ?? node.position;

    return {
      ...node,
      position: {
        x: Math.round(position.x),
        y: Math.round(position.y),
      },
    };
  });
}

function buildFlowEdges(graph: SupervisorMindMapGraph): SupervisorMindMapEdge[] {
  return graph.edges.map((edge) => {
    const isActivePathEdge =
      graph.activePathNodeIds.has(edge.source) && graph.activePathNodeIds.has(edge.target);

    return {
      ...edge,
      animated: false,
      className: isActivePathEdge
        ? "supervisor-mind-map-flow__edge supervisor-mind-map-flow__edge--active"
        : "supervisor-mind-map-flow__edge",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
      },
      style: {
        strokeWidth: isActivePathEdge ? 1.6 : 1.15,
      },
    };
  });
}

function SupervisorMindMapFlowInner({
  memory,
  onInspectNode,
  rootDetail,
  rootTitle,
  selectedNodeId,
}: SupervisorMindMapFlowProps) {
  const t = useTranslation();
  const reactFlow = useReactFlow<SupervisorMindMapNode, SupervisorMindMapEdge>();
  const viewport = useViewport();
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const nodePositionCacheRef = useRef<{
    key: string;
    positions: Map<string, MindMapNodePosition>;
  }>({
    key: "",
    positions: new Map(),
  });
  const autoFitMemoryKeyRef = useRef<string | null>(null);
  const memoryLayoutKey = `${memory.targetId}:${memory.planRevision}:${memory.planTree.id}`;

  if (nodePositionCacheRef.current.key !== memoryLayoutKey) {
    nodePositionCacheRef.current = {
      key: memoryLayoutKey,
      positions: new Map(),
    };
    autoFitMemoryKeyRef.current = null;
  }

  const graph = useMemo(
    () =>
      buildSupervisorMindMapGraph({
        memory,
        rootTitle,
        rootDetail,
        expandedNodeIds,
      }),
    [expandedNodeIds, memory, rootDetail, rootTitle]
  );
  const graphLayoutKey = graph.nodes
    .map(
      (node) =>
        `${node.id}:${node.data.expanded ? "1" : "0"}:${node.data.isActive ? "1" : "0"}:${node.data.isOnActivePath ? "1" : "0"}`
    )
    .join("\u0000");
  const fallbackNodes = useMemo(
    () =>
      createAnchoredSupervisorMindMapNodes({
        edges: graph.edges,
        nodes: graph.nodes,
        previousPositions: nodePositionCacheRef.current.positions,
      }),
    [graph]
  );
  const [layoutState, setLayoutState] = useState<{
    key: string;
    nodes: SupervisorMindMapNode[];
  }>(() => ({
    key: graphLayoutKey,
    nodes: fallbackNodes,
  }));
  const baseNodes = layoutState.key === graphLayoutKey ? layoutState.nodes : fallbackNodes;
  const nodes = useMemo(
    () =>
      baseNodes.map((node) => {
        const isSelected = node.id === selectedNodeId;
        const domAttributes = node.domAttributes as SupervisorMindMapDomAttributes | undefined;

        if (
          node.data.isSelected === isSelected &&
          domAttributes?.["data-selected-node"] === (isSelected ? "true" : undefined)
        ) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            isSelected,
          },
          domAttributes: {
            ...domAttributes,
            "data-selected-node": isSelected ? "true" : undefined,
          } as SupervisorMindMapDomAttributes,
        };
      }),
    [baseNodes, selectedNodeId]
  );
  const activeAncestorIds = useMemo(
    () => graph.activePath.slice(0, -1).flatMap((node) => (node.children.length ? [node.id] : [])),
    [graph.activePath]
  );
  const activeAncestorIdsKey = activeAncestorIds.join("\u0000");
  const expandableNodeIdsKey = graph.expandableNodeIds.join("\u0000");
  const hasCollapsedNodes = graph.expandableNodeIds.some((nodeId) => !expandedNodeIds.has(nodeId));
  const hasExpandedNodes = graph.expandableNodeIds.some((nodeId) => expandedNodeIds.has(nodeId));
  const edges = useMemo(() => buildFlowEdges(graph), [graph]);
  const [displayZoom, setDisplayZoom] = useState(viewport.zoom);
  const activeAncestorsExpanded = activeAncestorIds.every((nodeId) => expandedNodeIds.has(nodeId));

  useEffect(() => {
    if (!activeAncestorIds.length) {
      return;
    }

    setExpandedNodeIds((current) => {
      let next = current;

      for (const nodeId of activeAncestorIds) {
        if (!next.has(nodeId)) {
          if (next === current) {
            next = new Set(current);
          }
          next.add(nodeId);
        }
      }

      return next;
    });
  }, [activeAncestorIdsKey]);

  useEffect(() => {
    let cancelled = false;

    layoutSupervisorMindMapGraph(graph)
      .then((layoutedNodes) => {
        if (!cancelled) {
          setLayoutState({ key: graphLayoutKey, nodes: layoutedNodes });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLayoutState({ key: graphLayoutKey, nodes: fallbackNodes });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackNodes, graph, graphLayoutKey]);

  useEffect(() => {
    nodePositionCacheRef.current.positions = rememberSupervisorMindMapNodePositions(
      nodePositionCacheRef.current.positions,
      baseNodes
    );
  }, [baseNodes]);

  useEffect(() => {
    setDisplayZoom(viewport.zoom);
  }, [viewport.zoom]);

  useEffect(() => {
    if (
      !activeAncestorsExpanded ||
      layoutState.key !== graphLayoutKey ||
      autoFitMemoryKeyRef.current === memoryLayoutKey
    ) {
      return;
    }

    const frame = window.requestAnimationFrame?.(() => {
      autoFitMemoryKeyRef.current = memoryLayoutKey;
      void reactFlow.fitView({
        duration: MIND_MAP_VIEWPORT_DURATION,
        maxZoom: MIND_MAP_FIT_MAX_ZOOM,
        minZoom: MIND_MAP_MIN_ZOOM,
        padding: MIND_MAP_FIT_PADDING,
      });
    });

    return () => {
      if (typeof frame === "number") {
        window.cancelAnimationFrame?.(frame);
      }
    };
  }, [activeAncestorsExpanded, graphLayoutKey, layoutState.key, memoryLayoutKey, reactFlow]);

  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);

      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      return next;
    });
  }, []);
  const handleNodeClick = useCallback<NodeMouseHandler<SupervisorMindMapNode>>(
    (_event, node) => {
      onInspectNode?.(node.id);

      if (node.data.hasChildren) {
        handleToggleNode(node.id);
      }
    },
    [handleToggleNode, onInspectNode]
  );
  const handleExpandAll = useCallback(() => {
    setExpandedNodeIds(new Set(graph.expandableNodeIds));
  }, [expandableNodeIdsKey, graph.expandableNodeIds]);
  const handleCollapseAll = useCallback(() => {
    setExpandedNodeIds(new Set());
  }, []);
  const handleFitView = useCallback(() => {
    setDisplayZoom(1);
    void reactFlow.fitView({
      duration: MIND_MAP_VIEWPORT_DURATION,
      maxZoom: MIND_MAP_FIT_MAX_ZOOM,
      minZoom: MIND_MAP_MIN_ZOOM,
      padding: MIND_MAP_FIT_PADDING,
    });
  }, [reactFlow]);
  const handleZoomIn = useCallback(() => {
    setDisplayZoom((current) => {
      const next = Math.min(MIND_MAP_MAX_ZOOM, Number((current + 0.1).toFixed(2)));
      void reactFlow.zoomTo(next, { duration: MIND_MAP_VIEWPORT_DURATION });
      return next;
    });
  }, [reactFlow]);
  const handleZoomOut = useCallback(() => {
    setDisplayZoom((current) => {
      const next = Math.max(MIND_MAP_MIN_ZOOM, Number((current - 0.1).toFixed(2)));
      void reactFlow.zoomTo(next, { duration: MIND_MAP_VIEWPORT_DURATION });
      return next;
    });
  }, [reactFlow]);
  const nodeTypes = useMemo(() => createNodeTypes(handleToggleNode), [handleToggleNode]);
  const zoomLabel = formatMindMapZoom(displayZoom);

  return (
    <div
      className="supervisor-mind-map-flow"
      role="tree"
      aria-label={t("supervisor.target_memory.plan_tree_title")}
    >
      <div
        className="supervisor-mind-map-toolbar"
        role="toolbar"
        aria-label={t("supervisor.target_memory.map_toolbar_label")}
      >
        <Tooltip content={t("supervisor.target_memory.map_zoom_out")}>
          <IconButton
            aria-label={t("supervisor.target_memory.map_zoom_out")}
            className="supervisor-mind-map-tool"
            disabled={displayZoom <= MIND_MAP_MIN_ZOOM}
            icon={<ZoomOut size={14} />}
            onClick={handleZoomOut}
            size="sm"
          />
        </Tooltip>
        <span
          className="supervisor-mind-map-zoom-level"
          aria-label={t("supervisor.target_memory.map_zoom_level")}
        >
          {zoomLabel}
        </span>
        <Tooltip content={t("supervisor.target_memory.map_zoom_in")}>
          <IconButton
            aria-label={t("supervisor.target_memory.map_zoom_in")}
            className="supervisor-mind-map-tool"
            disabled={displayZoom >= MIND_MAP_MAX_ZOOM}
            icon={<ZoomIn size={14} />}
            onClick={handleZoomIn}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("supervisor.target_memory.map_fit_view")}>
          <IconButton
            aria-label={t("supervisor.target_memory.map_fit_view")}
            className="supervisor-mind-map-tool"
            icon={<Maximize2 size={14} />}
            onClick={handleFitView}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("supervisor.target_memory.expand_all")}>
          <IconButton
            aria-label={t("supervisor.target_memory.expand_all")}
            className="supervisor-mind-map-action"
            disabled={!hasCollapsedNodes}
            icon={<ChevronDown size={14} />}
            onClick={handleExpandAll}
            size="sm"
          />
        </Tooltip>
        <Tooltip content={t("supervisor.target_memory.collapse_all")}>
          <IconButton
            aria-label={t("supervisor.target_memory.collapse_all")}
            className="supervisor-mind-map-action"
            disabled={!hasExpandedNodes}
            icon={<ChevronRight size={14} />}
            onClick={handleCollapseAll}
            size="sm"
          />
        </Tooltip>
      </div>
      <div className="supervisor-mind-map-flow__viewport">
        <ReactFlow<SupervisorMindMapNode, SupervisorMindMapEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="system"
          defaultEdgeOptions={{ type: "smoothstep" }}
          elementsSelectable={false}
          fitView
          fitViewOptions={{
            maxZoom: MIND_MAP_FIT_MAX_ZOOM,
            minZoom: MIND_MAP_MIN_ZOOM,
            padding: MIND_MAP_FIT_PADDING,
          }}
          maxZoom={MIND_MAP_MAX_ZOOM}
          minZoom={MIND_MAP_MIN_ZOOM}
          nodesConnectable={false}
          nodesDraggable={false}
          onNodeClick={handleNodeClick}
          panOnDrag
          panOnScroll
          proOptions={{ hideAttribution: true }}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          zoomOnScroll
        >
          <Controls className="supervisor-mind-map-flow__controls" showInteractive={false} />
          <MiniMap<SupervisorMindMapNode>
            ariaLabel={t("supervisor.target_memory.map_minimap_label")}
            className="supervisor-mind-map-flow__minimap"
            maskColor="transparent"
            maskStrokeColor="var(--component-mix-border-default-44pct-transparent)"
            maskStrokeWidth={1}
            nodeBorderRadius={2}
            nodeColor={(node) =>
              node.data.isOnActivePath
                ? "var(--state-info-text)"
                : "var(--component-mix-border-default-84pct-surface-panel-16pct)"
            }
            nodeStrokeColor={(node) =>
              node.data.isActive
                ? "var(--state-info-text)"
                : "var(--component-mix-border-default-80pct-transparent)"
            }
            pannable
            position="bottom-right"
            style={MIND_MAP_MINIMAP_SIZE}
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function SupervisorMindMapFlow(props: SupervisorMindMapFlowProps) {
  return (
    <ReactFlowProvider>
      <SupervisorMindMapFlowInner {...props} />
    </ReactFlowProvider>
  );
}
