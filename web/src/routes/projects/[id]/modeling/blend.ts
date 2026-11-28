// Pure diagram transitions. Pages say "show this scene" and whether the
// change is a cut or a tween. They do not interpolate boxes or cameras.
import {
  annotationBounds,
  type Box,
  computePortPositions,
  nearestPortSpot,
  unionBox,
} from "./geometry";
import type {
  DiagramEdge,
  DiagramNode,
  DiagramNote,
  DiagramScene,
} from "./scene";

export const TRANSITION_MS = 320;
// Fraction of the viewport a fitted diagram fills. The single source of truth
// for every zoom-to-fill / fit-on-switch path (modeling, explore, inventory).
export const FIT_FRACTION = 0.9;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Tween {
  fromScene: DiagramScene;
  toScene: DiagramScene;
  fromCamera: Camera;
  toCamera: Camera;
  moveCamera: boolean;
  startedAt: number;
  duration: number;
}

export function emptyScene(): DiagramScene {
  return { nodes: [], edges: [], notes: [], overlays: [] };
}

export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Cubic ease-in-out: accelerates from rest over the first half and settles
// to rest over the second, so neither the start nor the end of a transition
// is abrupt.
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpBox(from: Box, to: Box, t: number): Box {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
}

export function blendCamera(from: Camera, to: Camera, t: number): Camera {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    zoom: lerp(from.zoom, to.zoom, t),
  };
}

export function fitCamera(
  bounds: Box,
  viewport: { width: number; height: number },
  fraction = FIT_FRACTION,
): Camera {
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (viewport.width * fraction) / Math.max(bounds.width, 1),
        (viewport.height * fraction) / Math.max(bounds.height, 1),
      ),
    ),
  );
  return {
    zoom,
    x: bounds.x + bounds.width / 2 - viewport.width / zoom / 2,
    y: bounds.y + bounds.height / 2 - viewport.height / zoom / 2,
  };
}

export function sceneBounds(scene: DiagramScene): Box | null {
  const boxes = [
    ...scene.nodes.map((node) => node.box),
    ...scene.notes.map((note) => annotationBounds(note)),
  ];
  if (boxes.length === 0) return null;
  return unionBox(boxes);
}

function takeMatch<T>(
  pool: T[],
  key: (item: T) => string,
  wanted: string,
): T | undefined {
  const index = pool.findIndex((item) => key(item) === wanted);
  if (index < 0) return undefined;
  return pool.splice(index, 1)[0];
}

function restingNode(
  node: DiagramNode,
  box: DiagramNode["box"],
  opacity: number,
  ports: DiagramNode["ports"],
): DiagramNode {
  return {
    ...node,
    box,
    opacity,
    selected: false,
    dimmed: false,
    reparentTarget: false,
    ports,
    handles: "none",
    // A retargeted tween starts from a blended frame; its slide is over.
    labelTween: undefined,
  };
}

// Blends port spots of a node present in both scenes so the dot slides
// along the outline instead of jumping. Both sides are first resolved to
// node-local x/y (explicit spots win, otherwise the role default from
// `computePortPositions`), lerped, then re-projected onto the in-between box
// with `nearestPortSpot` — so same-side drags, undo-to-default, and even
// side changes all travel the perimeter. Ports added mid-tween appear at
// their target; removed ones vanish (ports have no opacity to crossfade).
function blendPorts(
  fromBox: Box,
  from: DiagramNode["ports"],
  toBox: Box,
  to: DiagramNode["ports"],
  t: number,
): DiagramNode["ports"] {
  const fromAt = new Map(
    computePortPositions(fromBox.width, fromBox.height, from).map((port) => [
      port.label,
      port,
    ]),
  );
  const toAt = new Map(
    computePortPositions(toBox.width, toBox.height, to).map((port) => [
      port.label,
      port,
    ]),
  );
  const box = lerpBox(fromBox, toBox, t);
  const toOriginal = new Map(to.map((port) => [port.label, port]));
  const out: DiagramNode["ports"] = [];
  for (const [label, fromPort] of fromAt) {
    const toPort = toAt.get(label);
    const original = toOriginal.get(label);
    if (toPort === undefined || original === undefined) continue;
    const x = lerp(fromPort.x, toPort.x, t);
    const y = lerp(fromPort.y, toPort.y, t);
    // Everything but the spot comes from the target port. Keeping `visible`
    // matters: a shown port rides only its node's fade, so dropping it made
    // labels fade out with the leaving edges and pop back in at t = 1.
    out.push({
      ...original,
      spot: nearestPortSpot(box.width, box.height, x, y),
    });
  }
  for (const [label] of toAt) {
    if (fromAt.has(label)) continue;
    const original = toOriginal.get(label);
    if (original !== undefined) out.push({ ...original });
  }
  return out;
}

// Edges a resting scene actually puts on screen: both endpoints placed.
// Read-only scenes list every logical edge and leave this filter to the
// canvas, so matching their raw lists by id treated an edge whose node leaves
// (or arrives) as staying: solid while the node faded, then cut at t = 1.
function drawnEdges(scene: DiagramScene): DiagramEdge[] {
  const placed = new Set(scene.nodes.map((node) => node.index));
  return scene.edges.filter(
    (edge) => placed.has(edge.from) && placed.has(edge.to),
  );
}

export function blendScenes(
  from: DiagramScene,
  to: DiagramScene,
  t: number,
): DiagramScene {
  if (t <= 0) return from;
  if (t >= 1) return to;

  const incoming = [...to.nodes];
  const nodes: DiagramNode[] = [];
  for (const node of from.nodes) {
    const match = takeMatch(incoming, (item) => item.id, node.id);
    if (match) {
      const box = {
        ...lerpBox(node.box, match.box, t),
        textAlign: match.box.textAlign,
      };
      const blended = restingNode(
        match,
        box,
        1,
        blendPorts(node.box, node.ports, match.box, match.ports, t),
      );
      if (node.box.textAlign !== match.box.textAlign) {
        blended.labelTween = { from: node.box.textAlign, t };
      }
      nodes.push(blended);
    } else {
      nodes.push(restingNode(node, node.box, 1 - t, node.ports));
    }
  }
  for (const node of incoming) {
    nodes.push(restingNode(node, node.box, t, node.ports));
  }

  const incomingEdges = drawnEdges(to);
  const edges: DiagramEdge[] = [];
  for (const edge of drawnEdges(from)) {
    const match = takeMatch(incomingEdges, (item) => item.id, edge.id);
    if (match) edges.push({ ...match, selected: false, opacity: 1 });
    else edges.push({ ...edge, selected: false, opacity: 1 - t });
  }
  for (const edge of incomingEdges) {
    edges.push({ ...edge, selected: false, opacity: t });
  }

  // Notes are not matched. Both views key them by index (`note-0`), so a
  // crossfade would put two notes under one Svelte key. Fade every outgoing
  // note out and every incoming note in, and prefix the ids so they cannot collide.
  const notes: DiagramNote[] = [
    ...from.notes.map((note) => ({
      ...note,
      id: `out:${note.id}`,
      selected: false,
      opacity: 1 - t,
    })),
    ...to.notes.map((note) => ({
      ...note,
      id: `in:${note.id}`,
      selected: false,
      opacity: t,
    })),
  ];

  return { nodes: parentsFirst(nodes), edges, notes, overlays: [] };
}

// Nodes paint in array order and their bodies are opaque, so a container
// that only exists in the target scene (appended last above) would cover
// its own children while it fades in, then snap behind them at t = 1.
// Re-sort parents-first like `computeRenderOrder`; the sort is stable, so
// siblings keep their order. Depth only follows parents present in the
// blend, and the hop limit guards against a cycle when outgoing nodes
// carry indexes from the previous model.
function parentsFirst(nodes: DiagramNode[]): DiagramNode[] {
  const parentOf = new Map(nodes.map((node) => [node.index, node.parentIndex]));
  const depth = (node: DiagramNode): number => {
    let hops = 0;
    let current = node.parentIndex;
    while (
      current !== undefined &&
      parentOf.has(current) &&
      hops < nodes.length
    ) {
      hops += 1;
      current = parentOf.get(current);
    }
    return hops;
  };
  const depths = new Map(nodes.map((node) => [node, depth(node)]));
  return [...nodes].sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0));
}

export function frameAt(
  tween: Tween,
  now: number,
): { scene: DiagramScene; camera: Camera; done: boolean } {
  const raw = (now - tween.startedAt) / tween.duration;
  if (raw >= 1) {
    return {
      scene: tween.toScene,
      camera: tween.moveCamera ? tween.toCamera : tween.fromCamera,
      done: true,
    };
  }
  const t = easeInOutCubic(Math.max(0, raw));
  return {
    scene: blendScenes(tween.fromScene, tween.toScene, t),
    camera: tween.moveCamera
      ? blendCamera(tween.fromCamera, tween.toCamera, t)
      : tween.fromCamera,
    done: false,
  };
}

export function advance(
  displayed: { scene: DiagramScene; camera: Camera },
  desired: { scene: DiagramScene; camera: Camera | null },
  opts: {
    transition: boolean;
    moveCamera: boolean;
    reducedMotion: boolean;
    now: number;
    tween: Tween | null;
    /** Tween length in ms. Defaults to TRANSITION_MS; 0 cuts immediately. */
    durationMs?: number;
  },
): {
  scene: DiagramScene;
  camera: Camera;
  settling: boolean;
  tween: Tween | null;
} {
  const keepCamera = displayed.camera;
  const targetCamera =
    opts.moveCamera && desired.camera ? desired.camera : keepCamera;
  const durationMs = opts.durationMs ?? TRANSITION_MS;
  if (!opts.transition || opts.reducedMotion || durationMs <= 0) {
    return {
      scene: desired.scene,
      camera: targetCamera,
      settling: false,
      tween: null,
    };
  }
  const current = opts.tween ? frameAt(opts.tween, opts.now) : displayed;
  const tween: Tween = {
    fromScene: current.scene,
    toScene: desired.scene,
    fromCamera: current.camera,
    toCamera:
      opts.moveCamera && desired.camera ? desired.camera : current.camera,
    moveCamera: opts.moveCamera && desired.camera !== null,
    startedAt: opts.now,
    duration: durationMs,
  };
  const frame = frameAt(tween, opts.now);
  return {
    scene: frame.scene,
    camera: frame.camera,
    settling: true,
    tween,
  };
}
