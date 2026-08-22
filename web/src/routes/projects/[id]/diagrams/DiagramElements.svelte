<script lang="ts">
import {
  type Box,
  computeRenderOrder,
  computeVisibleConnections,
  elbowPath,
  type TextAlign,
  textPosition,
} from "./geometry";
import type {
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  markerId = "arrow",
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  markerId?: string;
} = $props();

function nodeBox(index: number): (Box & { textAlign: TextAlign }) | null {
  const box = boxes[index];
  if (!box) return null;
  return { ...box, textAlign: box.textAlign ?? "center" };
}

function parentOf(index: number): number | undefined {
  return components[index]?.parent_component_index;
}

let renderOrder = $derived(
  computeRenderOrder(Object.keys(boxes).map(Number), parentOf),
);

let visibleConnections = $derived(
  computeVisibleConnections(connections, (i) => nodeBox(i)),
);
</script>

<defs>
  <marker
    id={markerId}
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

{#each visibleConnections as { conn, a, b, orientation } (`${conn.label}-${conn.from}-${conn.to}`)}
  <path
    d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
    stroke="var(--color-base-content)"
    stroke-opacity="0.35"
    stroke-width="1.5"
    fill="none"
    marker-end="url(#{markerId})"
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
