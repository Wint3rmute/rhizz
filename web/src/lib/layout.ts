// Layout engine: computes 2D positions for a system's component/connection graph.
// Uses a simple force-directed approach with hierarchical grouping.

import type { Model, System, Component, Connection } from "./types.ts";

export interface LayoutNode {
  id: number; // ComponentId index
  label: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  leaf: boolean;
  tags: string[];
  children: LayoutNode[];
  ports: { label: string; protocol: string; role: string }[];
}

export interface LayoutEdge {
  id: number; // ConnectionId index
  label: string;
  description: string;
  fromId: number;
  toId: number;
  fromPort: string | null;
  toPort: string | null;
  tags: string[];
}

export interface GraphLayout {
  system: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const PADDING = 40;
const GROUP_PADDING = 30;

/**
 * Lay out a system's top-level components in a grid, expanding non-leaf
 * components to contain their children.
 */
export function layoutSystem(model: Model, systemIdx: number): GraphLayout {
  const system = model.systems[systemIdx];
  const topNodes = system.components.map((cid) =>
    buildNode(model, cid),
  );

  // Simple grid layout for top-level nodes
  const cols = Math.ceil(Math.sqrt(topNodes.length));
  let maxRowHeight = 0;
  let cx = PADDING;
  let cy = PADDING;
  let col = 0;

  for (const node of topNodes) {
    measureNode(node);
    node.x = cx;
    node.y = cy;
    cx += node.width + PADDING;
    maxRowHeight = Math.max(maxRowHeight, node.height);
    col++;
    if (col >= cols) {
      col = 0;
      cx = PADDING;
      cy += maxRowHeight + PADDING;
      maxRowHeight = 0;
    }
  }

  const totalWidth = topNodes.reduce((max, n) => Math.max(max, n.x + n.width), 0) + PADDING;
  const totalHeight = topNodes.reduce((max, n) => Math.max(max, n.y + n.height), 0) + PADDING;

  const edges = system.connections.map((connId) =>
    buildEdge(model, connId),
  );

  return {
    system: system.label,
    nodes: topNodes,
    edges,
    width: totalWidth,
    height: totalHeight,
  };
}

function buildNode(model: Model, componentId: number): LayoutNode {
  const comp = model.components[componentId];
  const ports = comp.ports.map((pid) => {
    const p = model.ports[pid];
    return { label: p.label, protocol: p.protocol, role: p.role };
  });
  const children = comp.children.map((cid) => buildNode(model, cid));

  return {
    id: componentId,
    label: comp.label,
    description: comp.description,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    leaf: comp.leaf,
    tags: comp.tags,
    children,
    ports,
  };
}

/** Recursively measure a node, expanding it to contain children. */
function measureNode(node: LayoutNode): void {
  if (node.children.length === 0) {
    node.width = NODE_WIDTH;
    node.height = NODE_HEIGHT;
    return;
  }

  // Lay children in a horizontal row inside the parent
  let innerX = GROUP_PADDING;
  let maxChildHeight = 0;
  for (const child of node.children) {
    measureNode(child);
    child.x = innerX;
    child.y = NODE_HEIGHT * 0.6 + GROUP_PADDING; // offset below parent label
    innerX += child.width + GROUP_PADDING;
    maxChildHeight = Math.max(maxChildHeight, child.height);
  }

  node.width = Math.max(NODE_WIDTH, innerX);
  node.height = NODE_HEIGHT * 0.6 + GROUP_PADDING + maxChildHeight + GROUP_PADDING;
}

function buildEdge(model: Model, connectionId: number): LayoutEdge {
  const conn = model.connections[connectionId];
  const fromPort = conn.from.port != null ? model.ports[conn.from.port].label : null;
  const toPort = conn.to.port != null ? model.ports[conn.to.port].label : null;

  return {
    id: connectionId,
    label: conn.label,
    description: conn.description,
    fromId: conn.from.component,
    toId: conn.to.component,
    fromPort,
    toPort,
    tags: conn.tags,
  };
}
