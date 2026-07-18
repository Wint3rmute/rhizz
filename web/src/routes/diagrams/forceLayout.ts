// Force-directed auto-layout for the diagrams canvas (web/src/routes/
// diagrams/+page.svelte). Deliberately has zero Svelte/DOM dependency —
// and, per TASKS.md Task 50's explicit constraint, zero dependency on
// `rhizz-wasm`/`rhizz-core` types — so it can be unit tested directly
// (see forceLayout.test.ts) and stays a pure "diagram data model"
// concern, not a domain-model one. Named forceLayout.ts rather than
// layout.ts to avoid colliding with SvelteKit's reserved `+layout.ts`
// route-file naming convention (a bare `layout.ts` living directly inside
// a routes/ directory triggers a "did you mean +layout.ts?" warning from
// svelte-kit sync).
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Box } from "./geometry";

// A node to be laid out. `index` is the diagram's own component arena
// index (opaque to this module — never interpreted, only round-tripped
// back out in LayoutResult). `fixed` pins the node in place (via d3-force's
// fx/fy): used for "only lay out newly-added nodes, don't disturb
// everything else" (see TASKS.md Task 50's "new nodes added" use-case).
export type LayoutNode = {
  index: number;
  box: Box;
  fixed?: boolean;
};

export type LayoutEdge = { from: number; to: number };

export type LayoutResult = { index: number; x: number; y: number };

export type ForceLayoutOptions = {
  // World-space point the whole layout is gently centered around.
  centerX?: number;
  centerY?: number;
  // Target rest length for the link (connection) force, in world units.
  linkDistance?: number;
  // Repulsion strength between every pair of nodes (negative = repel).
  chargeStrength?: number;
  // Extra spacing enforced between nodes' circumscribing circles, on top
  // of their own radii, so boxes don't end up edge-to-edge with zero gap.
  collidePadding?: number;
};

const DEFAULT_LINK_DISTANCE = 160;
const DEFAULT_CHARGE_STRENGTH = -300;
const DEFAULT_COLLIDE_PADDING = 20;

// Ticks/convergence defaults for runForceLayout's synchronous loop.
const DEFAULT_MAX_TICKS = 300;
const DEFAULT_ALPHA_MIN = 0.001;

// d3-force assigns its OWN `index` property to every simulation node
// (each node's position in the array passed to forceSimulation), so this
// can't be named `index` without silently colliding with — and being
// overwritten by — that mechanism. `componentIndex` is this module's
// separate, opaque round-trip identifier (see LayoutNode above).
interface SimNode extends SimulationNodeDatum {
  componentIndex: number;
  radius: number;
}

// A running (but externally-driven) force simulation: call tick()
// repeatedly — e.g. once per animation frame — to advance it, reading
// back the current positions each time. The underlying d3-force
// simulation is created with .stop() called immediately, so it never
// advances on its own internal timer; this object is the only way to
// step it forward.
export type ForceLayout = {
  tick: () => LayoutResult[];
  alpha: () => number;
};

// Builds a force layout for `nodes`, using `edges` (filtered to only
// those whose endpoints are both present in `nodes`) as attraction links.
// Node positions are seeded from each box's current centre, so nodes
// already reasonably placed only need to move a little; each node's
// radius (for the collision force) approximates its box as a
// circumscribing circle — good enough to avoid visible overlap without
// rectangle-vs-rectangle collision math.
export function createForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: ForceLayoutOptions = {},
): ForceLayout {
  const {
    centerX = 0,
    centerY = 0,
    linkDistance = DEFAULT_LINK_DISTANCE,
    chargeStrength = DEFAULT_CHARGE_STRENGTH,
    collidePadding = DEFAULT_COLLIDE_PADDING,
  } = options;

  const boxByIndex = new Map(nodes.map((n) => [n.index, n.box]));

  const simNodes: SimNode[] = nodes.map((n) => {
    const cx = n.box.x + n.box.width / 2;
    const cy = n.box.y + n.box.height / 2;
    return {
      componentIndex: n.index,
      x: cx,
      y: cy,
      radius: Math.hypot(n.box.width, n.box.height) / 2,
      ...(n.fixed ? { fx: cx, fy: cy } : {}),
    };
  });

  const simNodeByIndex = new Map(simNodes.map((n) => [n.componentIndex, n]));

  const simLinks: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => simNodeByIndex.has(e.from) && simNodeByIndex.has(e.to))
    .map((e) => ({
      source: simNodeByIndex.get(e.from) as SimNode,
      target: simNodeByIndex.get(e.to) as SimNode,
    }));

  const simulation: Simulation<SimNode, SimulationLinkDatum<SimNode>> =
    forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(chargeStrength))
      .force("link", forceLink(simLinks).distance(linkDistance))
      .force(
        "collide",
        forceCollide<SimNode>((n) => n.radius + collidePadding),
      )
      .force("center", forceCenter(centerX, centerY))
      .stop();

  function extractResults(): LayoutResult[] {
    return simNodes.map((n) => {
      const box = boxByIndex.get(n.componentIndex);
      const width = box?.width ?? 0;
      const height = box?.height ?? 0;
      return {
        index: n.componentIndex,
        x: (n.x ?? 0) - width / 2,
        y: (n.y ?? 0) - height / 2,
      };
    });
  }

  return {
    tick: () => {
      simulation.tick();
      return extractResults();
    },
    alpha: () => simulation.alpha(),
  };
}

// Partitions `nodes` into sibling groups by their immediate parent —
// `parentOf(node.index)`, with `undefined` meaning "top-level" (no
// parent, or a parent that isn't itself in the target set). Each
// resulting group contains only nodes that share the same immediate
// parent, preserving input order within a group. Used to run one
// independent force simulation per group rather than one flat simulation
// mixing unrelated hierarchy levels together (see TASKS.md Task 50: a
// node shouldn't be repelled by/attracted to a node it's not actually a
// sibling of, just because both happen to be in the same auto-layout
// invocation).
export function groupBySiblings<T extends { index: number }>(
  nodes: T[],
  parentOf: (index: number) => number | undefined,
): Map<number | undefined, T[]> {
  const groups = new Map<number | undefined, T[]>();
  for (const node of nodes) {
    const parent = parentOf(node.index);
    const group = groups.get(parent);
    if (group) {
      group.push(node);
    } else {
      groups.set(parent, [node]);
    }
  }
  return groups;
}

// Convenience wrapper for callers that just want a final, converged
// layout synchronously (e.g. tests, or a "no animation" fallback) instead
// of driving the simulation frame-by-frame themselves. Runs until alpha
// decays below alphaMin or maxTicks is reached, whichever comes first.
export function runForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: ForceLayoutOptions & {
    maxTicks?: number;
    alphaMin?: number;
  } = {},
): LayoutResult[] {
  if (nodes.length === 0) return [];

  const { maxTicks = DEFAULT_MAX_TICKS, alphaMin = DEFAULT_ALPHA_MIN } =
    options;
  const layout = createForceLayout(nodes, edges, options);

  let result: LayoutResult[] = [];
  for (let i = 0; i < maxTicks; i++) {
    result = layout.tick();
    if (layout.alpha() < alphaMin) break;
  }
  return result;
}
