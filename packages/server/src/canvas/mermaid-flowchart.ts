export interface MermaidFlowchartNode {
  id: string;
  label?: string;
}

export interface MermaidFlowchartEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MermaidFlowchartGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface MermaidFlowchartGraph {
  direction?: "TB" | "TD" | "BT" | "LR" | "RL";
  groups: MermaidFlowchartGroup[];
  nodes: MermaidFlowchartNode[];
  edges: MermaidFlowchartEdge[];
}

function normalizeGroupId(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "group"
  );
}

function parseNodeToken(token: string): MermaidFlowchartNode {
  const trimmed = token.trim();
  const labeled = trimmed.match(/^([A-Za-z0-9_-]+)\[(.+)\]$/u);
  if (labeled) {
    return {
      id: labeled[1]!,
      label: labeled[2]!.trim(),
    };
  }

  const bare = trimmed.match(/^([A-Za-z0-9_-]+)$/u);
  if (bare) {
    return { id: bare[1]! };
  }

  throw new Error(`Unsupported Mermaid node token: ${trimmed}`);
}

function upsertNode(
  nodes: Map<string, MermaidFlowchartNode>,
  node: MermaidFlowchartNode
): MermaidFlowchartNode {
  const existing = nodes.get(node.id);
  const next = {
    id: node.id,
    label: node.label ?? existing?.label,
  };
  nodes.set(node.id, next);
  return next;
}

function parseEdgeLine(line: string): MermaidFlowchartEdge & {
  fromNode: MermaidFlowchartNode;
  toNode: MermaidFlowchartNode;
} {
  const labeled = line.match(/^(.*?)\s*-->\|(.*?)\|\s*(.*?)$/u);
  if (labeled) {
    const fromNode = parseNodeToken(labeled[1]!);
    const toNode = parseNodeToken(labeled[3]!);
    return {
      from: fromNode.id,
      to: toNode.id,
      label: labeled[2]!.trim() || undefined,
      fromNode,
      toNode,
    };
  }

  const plain = line.match(/^(.*?)\s*-->\s*(.*?)$/u);
  if (plain) {
    const fromNode = parseNodeToken(plain[1]!);
    const toNode = parseNodeToken(plain[2]!);
    return {
      from: fromNode.id,
      to: toNode.id,
      fromNode,
      toNode,
    };
  }

  throw new Error(`Unsupported Mermaid flowchart statement: ${line}`);
}

function trackNodeInGroups(groups: MermaidFlowchartGroup[], nodeId: string): void {
  for (const group of groups) {
    if (!group.nodeIds.includes(nodeId)) {
      group.nodeIds.push(nodeId);
    }
  }
}

export function parseMermaidFlowchart(source: string): MermaidFlowchartGraph {
  const nodes = new Map<string, MermaidFlowchartNode>();
  const edges: MermaidFlowchartEdge[] = [];
  const groups: MermaidFlowchartGroup[] = [];
  const groupStack: MermaidFlowchartGroup[] = [];
  let direction: MermaidFlowchartGraph["direction"];

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const header = line.match(/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)$/u);
    if (header) {
      direction = header[2] as MermaidFlowchartGraph["direction"];
      continue;
    }

    if (line.startsWith("subgraph ")) {
      const label = line.slice("subgraph ".length).trim();
      if (!label) {
        throw new Error("Mermaid subgraph label is required");
      }

      const group: MermaidFlowchartGroup = {
        id: normalizeGroupId(label),
        label,
        nodeIds: [],
      };
      groups.push(group);
      groupStack.push(group);
      continue;
    }

    if (line === "end") {
      if (groupStack.length === 0) {
        throw new Error("Unexpected Mermaid subgraph terminator");
      }
      groupStack.pop();
      continue;
    }

    if (line.includes("-->")) {
      const edge = parseEdgeLine(line);
      const fromNode = upsertNode(nodes, edge.fromNode);
      const toNode = upsertNode(nodes, edge.toNode);
      trackNodeInGroups(groupStack, fromNode.id);
      trackNodeInGroups(groupStack, toNode.id);
      edges.push({
        from: edge.from,
        to: edge.to,
        label: edge.label,
      });
      continue;
    }

    try {
      const node = upsertNode(nodes, parseNodeToken(line));
      trackNodeInGroups(groupStack, node.id);
      continue;
    } catch {
      throw new Error(`Unsupported Mermaid flowchart statement: ${line}`);
    }
  }

  if (groupStack.length > 0) {
    throw new Error("Unterminated Mermaid subgraph");
  }

  return {
    direction,
    groups: groups.filter((group) => group.nodeIds.length > 0),
    nodes: [...nodes.values()],
    edges,
  };
}
