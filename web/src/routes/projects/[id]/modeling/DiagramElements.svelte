<script lang="ts">
import {
  type Box,
  computeRenderOrder,
  computeVisibleConnections,
  elbowPath,
  type TextAlign,
} from "./geometry";
import AnnotationText from "./AnnotationText.svelte";
import { resolveIcon } from "../../../../iconHelper";
import DiagramNodeBody from "./DiagramNodeBody.svelte";
import type {
  DiagramStaticAnnotation,
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  annotations = [],
  markerId = "arrow",
  selected = new Set<number>(),
  linked = new Set<number>(),
  onnodeclick,
  onnodehover,
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  /** View-level text annotations (absolute canvas positions). */
  annotations?: DiagramStaticAnnotation[];
  markerId?: string;
  /** Component indices to show as selected (drawn with a transparent dotted outline on top). */
  selected?: Set<number>;
  linked?: Set<number>;
  onnodeclick?: ((index: number) => void) | undefined;
  /** Optional hover callback — fired with the component index + mouse event on enter, then with `null` on leave. */
  onnodehover?:
    | ((index: number | null, event?: MouseEvent) => void)
    | undefined;
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
    <a
  href={onnodeclick ? "#" : undefined}
  aria-label={onnodeclick
        ? `${component.label}${
          linked.has(index) ? ", open detailed view" : ", no detailed view"
        }`
        : undefined}
  onclick={onnodeclick
        ? (event) => {
          event.preventDefault();
          onnodeclick(index);
        }
        : undefined}
  onmouseenter={onnodehover ? (e) => onnodehover?.(index, e) : undefined}
  onmousemove={onnodehover ? (e) => onnodehover?.(index, e) : undefined}
  onmouseleave={onnodehover ? (e) => onnodehover?.(null, e) : undefined}
>
  <g
    transform="translate({box.x}, {box.y})"
    class:cursor-pointer={onnodeclick !== undefined}
    class:opacity-90={onnodeclick !== undefined && !linked.has(index)}
  >
    <DiagramNodeBody
      label={component.label}
      width={box.width}
      height={box.height}
      textAlign={box.textAlign}
      icon={resolveIcon(component.icon)}
      color={component.color}
      border={component.border}
      font={component.font}
      selected={selected.has(index)}
    />
  </g>
</a>
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

{#each annotations as ann (ann.text + ann.x + ann.y)}
  <AnnotationText
  text={ann.text}
  x={ann.x}
  y={ann.y}
  scale={ann.scale ?? 1}
/>
{/each}
