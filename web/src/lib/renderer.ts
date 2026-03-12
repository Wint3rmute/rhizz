// Three.js SVG-based renderer for system diagrams.
// Renders LayoutNodes as rectangles and LayoutEdges as lines.

import * as THREE from "three";
import { SVGRenderer } from "three/addons/renderers/SVGRenderer.js";
import type { GraphLayout, LayoutNode, LayoutEdge } from "./layout.ts";

const COLORS = {
  nodeFill: 0xe8f4f8,
  nodeStroke: 0x4a90d9,
  groupFill: 0xf0f0f0,
  groupStroke: 0x999999,
  edgeLine: 0x666666,
  edgeHighlight: 0xff6600,
  text: 0x333333,
  background: 0xffffff,
  hoverFill: 0xd0e8f5,
};

export interface RendererState {
  renderer: SVGRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  cleanup: () => void;
  /** Export the current view as an SVG string. */
  exportSVG: () => string;
}

export interface HoverInfo {
  label: string;
  description: string;
  tags: string[];
  ports: { label: string; protocol: string; role: string }[];
  kind: "node" | "edge";
}

export function createRenderer(
  container: HTMLElement,
  layout: GraphLayout,
  onHover: (info: HoverInfo | null) => void,
): RendererState {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Orthographic camera looking at the layout
  const pad = 60;
  const camera = new THREE.OrthographicCamera(
    -pad,
    layout.width + pad,
    -pad,
    layout.height + pad,
    -10,
    10,
  );
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // Build the scene graph
  const nodeMap = new Map<number, { globalX: number; globalY: number; width: number; height: number }>();
  addNodes(scene, layout.nodes, 0, 0, nodeMap);
  addEdges(scene, layout.edges, nodeMap);

  // SVG renderer
  const renderer = new SVGRenderer();
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  renderer.render(scene, camera);

  // Pan and zoom
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function updateCamera() {
    const hw = (width / 2) / zoom;
    const hh = (height / 2) / zoom;
    const cx = (layout.width / 2) + panX;
    const cy = (layout.height / 2) + panY;
    camera.left = cx - hw;
    camera.right = cx + hw;
    camera.top = cy - hh;
    camera.bottom = cy + hh;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.1, Math.min(10, zoom * factor));
    updateCamera();
  }

  function onMouseDown(e: MouseEvent) {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (isDragging) {
      const dx = (e.clientX - lastMouseX) / zoom;
      const dy = (e.clientY - lastMouseY) / zoom;
      panX -= dx;
      panY -= dy;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      updateCamera();
    }

    // Hit-test for hover info
    const rect = renderer.domElement.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * (camera.right - camera.left) + camera.left;
    const my = ((e.clientY - rect.top) / rect.height) * (camera.bottom - camera.top) + camera.top;

    let hit: HoverInfo | null = null;
    for (const node of flattenNodes(layout.nodes, 0, 0)) {
      if (
        mx >= node.globalX &&
        mx <= node.globalX + node.width &&
        my >= node.globalY &&
        my <= node.globalY + node.height
      ) {
        hit = {
          label: node.label,
          description: node.description,
          tags: node.tags,
          ports: node.ports,
          kind: "node",
        };
      }
    }
    onHover(hit);
  }

  function onMouseUp() {
    isDragging = false;
  }

  const el = renderer.domElement;
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  // Initial fit
  updateCamera();

  function cleanup() {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    if (el.parentElement) el.parentElement.removeChild(el);
  }

  function exportSVG(): string {
    return renderer.domElement.outerHTML;
  }

  return { renderer, scene, camera, cleanup, exportSVG };
}

// ── Scene building ──────────────────────────────────────────────────

function addNodes(
  parent: THREE.Object3D,
  nodes: LayoutNode[],
  offsetX: number,
  offsetY: number,
  nodeMap: Map<number, { globalX: number; globalY: number; width: number; height: number }>,
) {
  for (const node of nodes) {
    const gx = offsetX + node.x;
    const gy = offsetY + node.y;
    nodeMap.set(node.id, { globalX: gx, globalY: gy, width: node.width, height: node.height });

    const isGroup = node.children.length > 0;
    const fillColor = isGroup ? COLORS.groupFill : COLORS.nodeFill;
    const strokeColor = isGroup ? COLORS.groupStroke : COLORS.nodeStroke;

    // Background rectangle
    const rectGeom = new THREE.PlaneGeometry(node.width, node.height);
    const rectMat = new THREE.MeshBasicMaterial({ color: fillColor });
    const rect = new THREE.Mesh(rectGeom, rectMat);
    rect.position.set(gx + node.width / 2, gy + node.height / 2, 0);
    parent.add(rect);

    // Border (wireframe outline)
    const edgesGeom = new THREE.EdgesGeometry(rectGeom);
    const edgesMat = new THREE.LineBasicMaterial({ color: strokeColor, linewidth: isGroup ? 1 : 2 });
    const border = new THREE.LineSegments(edgesGeom, edgesMat);
    border.position.copy(rect.position);
    parent.add(border);

    // Recurse into children
    if (node.children.length > 0) {
      addNodes(parent, node.children, gx, gy, nodeMap);
    }
  }
}

function addEdges(
  parent: THREE.Object3D,
  edges: LayoutEdge[],
  nodeMap: Map<number, { globalX: number; globalY: number; width: number; height: number }>,
) {
  for (const edge of edges) {
    const from = nodeMap.get(edge.fromId);
    const to = nodeMap.get(edge.toId);
    if (!from || !to) continue;

    const x1 = from.globalX + from.width / 2;
    const y1 = from.globalY + from.height / 2;
    const x2 = to.globalX + to.width / 2;
    const y2 = to.globalY + to.height / 2;

    const points = [new THREE.Vector3(x1, y1, 0.1), new THREE.Vector3(x2, y2, 0.1)];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: COLORS.edgeLine, linewidth: 1 });
    const line = new THREE.Line(geom, mat);
    parent.add(line);

    // Arrowhead
    const dir = new THREE.Vector2(x2 - x1, y2 - y1).normalize();
    const arrowLen = 10;
    const arrowAngle = Math.PI / 6;
    const tipX = x2 - dir.x * (to.width / 2);
    const tipY = y2 - dir.y * (to.height / 2);

    const leftX = tipX - arrowLen * Math.cos(Math.atan2(dir.y, dir.x) - arrowAngle);
    const leftY = tipY - arrowLen * Math.sin(Math.atan2(dir.y, dir.x) - arrowAngle);
    const rightX = tipX - arrowLen * Math.cos(Math.atan2(dir.y, dir.x) + arrowAngle);
    const rightY = tipY - arrowLen * Math.sin(Math.atan2(dir.y, dir.x) + arrowAngle);

    const arrowPoints = [
      new THREE.Vector3(leftX, leftY, 0.1),
      new THREE.Vector3(tipX, tipY, 0.1),
      new THREE.Vector3(rightX, rightY, 0.1),
    ];
    const arrowGeom = new THREE.BufferGeometry().setFromPoints(arrowPoints);
    const arrowMat = new THREE.LineBasicMaterial({ color: COLORS.edgeLine, linewidth: 1 });
    const arrow = new THREE.Line(arrowGeom, arrowMat);
    parent.add(arrow);
  }
}

interface FlatNode {
  globalX: number;
  globalY: number;
  width: number;
  height: number;
  label: string;
  description: string;
  tags: string[];
  ports: { label: string; protocol: string; role: string }[];
}

function flattenNodes(nodes: LayoutNode[], offsetX: number, offsetY: number): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of nodes) {
    const gx = offsetX + node.x;
    const gy = offsetY + node.y;
    out.push({
      globalX: gx,
      globalY: gy,
      width: node.width,
      height: node.height,
      label: node.label,
      description: node.description,
      tags: node.tags,
      ports: node.ports,
    });
    if (node.children.length > 0) {
      out.push(...flattenNodes(node.children, gx, gy));
    }
  }
  return out;
}
