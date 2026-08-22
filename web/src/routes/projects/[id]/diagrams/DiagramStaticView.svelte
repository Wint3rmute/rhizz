<script lang="ts">
// A read-only, non-interactive rendering of a diagram's placed nodes and
// connections — a smaller, first-cut extraction of +page.svelte's canvas
// rendering, deliberately stripped of everything that makes the real
// canvas heavy to mount standalone: no drag/resize/marquee/pan/zoom
// interaction, no undo history, no auto-layout, and critically, no
// dependency on rhizz_wasm_wrapper/"rhizz" at all. `components`/
// `connections` below are plain, hand-shaped types that happen to be
// structurally compatible with rhizz's generated ComponentJS/ConnectionJS
// (same field names/types) rather than importing those classes directly
// — so this component (and its Storybook stories) never touch the WASM
// module, and can render example diagrams from plain literal data. A
// real interactive canvas extracted the same way (TASKS.md, "smaller
// step") would still accept its `components`/`connections` this way; only
// the page gluing it to compile_system()'s actual output would need the
// real types.
import {
  type Box,
  computeRenderOrder,
  computeVisibleConnections,
  depthOf,
  elbowPath,
  type TextAlign,
  textPosition,
} from "./geometry";

export interface DiagramStaticComponent {
  label: string;
  /** Index (into `components`) of this component's parent, if it has one — used only to decide render order (children drawn on top of their parent). */
  parent_component_index?: number;
}

export interface DiagramStaticConnection {
  from: number;
  to: number;
  label: string;
}

/** A placed node's position/size/label alignment — `textAlign` defaults to "center" when omitted. */
export type DiagramStaticBox = Box & { textAlign?: TextAlign };

let {
  components,
  connections,
  boxes,
  padding = 40,
}: {
  /** Indexed the same way `connections[].from`/`.to` and `boxes`' keys are — i.e. this is expected to be the *full* component list, not just the placed ones. */
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  /** Which components are actually placed on the canvas, and where — keyed by index into `components`. A component with no entry here simply isn't rendered. */
  boxes: Record<number, DiagramStaticBox>;
  /** Empty space (world units) left around the content's bounding box in the auto-fit viewBox. */
  padding?: number;
} = $props();

function nodeBox(index: number): (Box & { textAlign: TextAlign }) | null {
  const box = boxes[index];
  if (!box) return null;
  return { ...box, textAlign: box.textAlign ?? "center" };
}

function parentOf(index: number): number | undefined {
  return components[index]?.parent_component_index;
}

// Parents before children, so a child's fill never sits underneath its
// (larger, drawn-later-otherwise) parent — same ordering +page.svelte's
// `renderOrder` uses.
let renderOrder = $derived(
  computeRenderOrder(Object.keys(boxes).map(Number), parentOf),
);

let visibleConnections = $derived(
  computeVisibleConnections(connections, (i) => nodeBox(i)),
);

// Auto-fits the viewBox to whatever's actually placed, rather than
// requiring a caller-managed pan/zoom state (there's no interaction here
// to drive one) — makes this genuinely a one-prop-in, rendered-diagram-out
// component, ideal for a Storybook thumbnail.
let viewBox = $derived.by(() => {
  const placed = renderOrder
    .map((index) => nodeBox(index))
    .filter((box): box is NonNullable<ReturnType<typeof nodeBox>> =>
      box !== null
    );
  if (placed.length === 0) return "0 0 100 100";
  const minX = Math.min(...placed.map((b) => b.x));
  const minY = Math.min(...placed.map((b) => b.y));
  const maxX = Math.max(...placed.map((b) => b.x + b.width));
  const maxY = Math.max(...placed.map((b) => b.y + b.height));
  return `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${
    maxY - minY + padding * 2
  }`;
});
</script>

<svg
  version="1.1"
  width="100%"
  height="100%"
  xmlns="http://www.w3.org/2000/svg"
  viewBox={viewBox}
>
  <defs>
    <marker
      id="arrow"
      markerWidth="8"
      markerHeight="6"
      refX="8"
      refY="3"
      orient="auto"
    >
      <polygon
        points="0 0, 8 3, 0 6"
        fill="var(--color-base-content)"
        fill-opacity="0.5"
      />
    </marker>
  </defs>

  {#each renderOrder as index (index)}
    {@const box = nodeBox(index)}
    {@const component = components[index]}
    {#if box && component}
      {@const textPos = textPosition(box.textAlign, box.width, box.height)}
      <g transform="translate({box.x}, {box.y})">
        <rect
          width={box.width}
          height={box.height}
          rx="5"
          stroke="var(--color-base-content)"
          stroke-width="1"
          fill="var(--color-base-200)"
        />
        <text
          x={textPos.x}
          y={textPos.y}
          fill="var(--color-base-content)"
          text-anchor={textPos.anchor}
          dominant-baseline={textPos.baseline}
          style="pointer-events: none; user-select: none"
        >
          {component.label}
        </text>
      </g>
    {/if}
  {/each}

  <!--
    Connections are drawn after (on top of) nodes so arrows/labels are
    never hidden behind an opaque node fill — matches +page.svelte's own
    real canvas.
  -->
  {#each visibleConnections as { conn, a, b, orientation } (`${conn.label}-${conn.from}-${conn.to}`)}
    <path
      d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
      stroke="var(--color-base-content)"
      stroke-opacity="0.35"
      stroke-width="1.5"
      fill="none"
      marker-end="url(#arrow)"
      style="pointer-events: none"
    />
    <text
      x={(a.x + b.x) / 2}
      y={(a.y + b.y) / 2 - 6}
      fill="var(--color-base-content)"
      fill-opacity="0.5"
      font-size="10"
      text-anchor="middle"
      style="pointer-events: none; user-select: none"
    >
      {conn.label}
    </text>
  {/each}
</svg>
