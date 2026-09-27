// Pure diagram transitions. Pages say "show this scene" and whether the
// change is a cut or a tween. They do not interpolate boxes or cameras.
import { annotationBounds, type Box, unionBox } from "./geometry";
import type {
  DiagramEdge,
  DiagramNode,
  DiagramNote,
  DiagramScene,
} from "./scene";

export const TRANSITION_MS = 320;
export const FIT_FRACTION = 0.8;
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

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
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
): DiagramNode {
  return {
    ...node,
    box,
    opacity,
    selected: false,
    dimmed: false,
    reparentTarget: false,
    ports: [],
    handles: "none",
  };
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
      nodes.push(restingNode(
        match,
        {
          ...lerpBox(node.box, match.box, t),
          textAlign: match.box.textAlign,
        },
        1,
      ));
    } else {
      nodes.push(restingNode(node, node.box, 1 - t));
    }
  }
  for (const node of incoming) {
    nodes.push(restingNode(node, node.box, t));
  }

  const incomingEdges = [...to.edges];
  const edges: DiagramEdge[] = [];
  for (const edge of from.edges) {
    const match = takeMatch(incomingEdges, (item) => item.id, edge.id);
    if (match) edges.push({ ...match, selected: false, opacity: 1 });
    else edges.push({ ...edge, selected: false, opacity: 1 - t });
  }
  for (const edge of incomingEdges) {
    edges.push({ ...edge, selected: false, opacity: t });
  }

  const incomingNotes = [...to.notes];
  const notes: DiagramNote[] = [];
  for (const note of from.notes) {
    const match = takeMatch(incomingNotes, (item) => item.text, note.text);
    if (match) {
      notes.push({
        ...match,
        x: lerp(note.x, match.x, t),
        y: lerp(note.y, match.y, t),
        scale: lerp(note.scale, match.scale, t),
        selected: false,
        opacity: 1,
      });
    } else {
      notes.push({ ...note, selected: false, opacity: 1 - t });
    }
  }
  for (const note of incomingNotes) {
    notes.push({ ...note, selected: false, opacity: t });
  }

  return { nodes, edges, notes, overlays: [] };
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
  const t = easeOutCubic(Math.max(0, raw));
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
  },
): {
  scene: DiagramScene;
  camera: Camera;
  settling: boolean;
  tween: Tween | null;
} {
  const keepCamera = displayed.camera;
  const targetCamera = opts.moveCamera && desired.camera
    ? desired.camera
    : keepCamera;
  if (!opts.transition || opts.reducedMotion) {
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
    toCamera: opts.moveCamera && desired.camera
      ? desired.camera
      : current.camera,
    moveCamera: opts.moveCamera && desired.camera !== null,
    startedAt: opts.now,
    duration: TRANSITION_MS,
  };
  const frame = frameAt(tween, opts.now);
  return {
    scene: frame.scene,
    camera: frame.camera,
    settling: true,
    tween,
  };
}
